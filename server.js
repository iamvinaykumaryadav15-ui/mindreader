require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Razorpay = require('razorpay');
const geoip = require('geoip-lite');
const paypal = require('paypal-rest-sdk'); // Added PayPal SDK

// --- DEVELOPMENT SETTING: Change this to test different gateways ---
const IS_LOCAL_TESTING_INDIA = false;

const app = express();
const port = 3000;

// --- MIDDLEWARE SETUP ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'super-secret-key', resave: false, saveUninitialized: true, cookie: { secure: false } }));
app.use(passport.initialize());
app.use(passport.session());
app.enable('trust proxy');

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    waitForConnections: true, connectionLimit: 10, queueLimit: 0
}).promise();
db.getConnection().then(() => console.log('MySQL Connected...')).catch(err => console.error('Error connecting to MySQL:', err));

// --- PAYMENT GATEWAY SETUP ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// PayPal Live Mode Configuration
paypal.configure({
    mode: 'live', // Use 'sandbox' for testing
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// --- PASSPORT.JS (GOOGLE AUTH) SETUP ---
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value;
        const googleId = profile.id;
        let [users] = await db.query('SELECT * FROM users WHERE googleId = ?', [googleId]);
        if (users.length > 0) { return done(null, users[0]); }
        else {
            let [existingEmail] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
            if (existingEmail.length > 0) {
                await db.query('UPDATE users SET googleId = ? WHERE email = ?', [googleId, email]);
                let [updatedUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
                return done(null, updatedUser[0]);
            } else {
                const [result] = await db.query('INSERT INTO users (email, googleId) VALUES (?, ?)', [email, googleId]);
                const newUser = { id: result.insertId, email, googleId, credits: 0, has_unlimited: false };
                return done(null, newUser);
            }
        }
    } catch (err) { return done(err, null); }
}));
passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser(async (id, done) => {
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        done(null, rows.length > 0 ? rows[0] : false);
    } catch (err) { done(err, null); }
});

// --- ROUTES ---
app.get('/', (req, res) => {
    const { error, message, payment } = req.query;
    const ip = req.ip;
    let country;
    if (ip === '::1' || ip === '127.0.0.1') {
        country = IS_LOCAL_TESTING_INDIA ? 'IN' : 'US';
    } else {
        const geo = geoip.lookup(ip);
        country = (geo && geo.country) ? geo.country : 'US';
    }
    res.render('index', { user: req.user, error, message, payment, country, razorpayKeyId: process.env.RAZORPAY_KEY_ID });
});

// --- AUTH ROUTES ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?error=Google login failed' }), (req, res) => { res.redirect('/'); });
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.redirect('/?error=Email and password are required.');
        if (password.length < 6) return res.redirect('/?error=Password must be at least 6 characters long.');
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.redirect('/?message=Registration successful! Please login.');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') res.redirect('/?error=Email already exists.');
        else res.redirect('/?error=An error occurred during registration.');
    }
});
app.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.redirect('/?error=Email and password are required.');
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            const user = rows[0];
            if (!user.password) return res.redirect('/?error=Please login using your Google account.');
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.login(user, (err) => { if (err) { return next(err); } return res.redirect('/'); });
            } else { res.redirect('/?error=Incorrect password.'); }
        } else { res.redirect('/?error=User not found.'); }
    } catch (error) { res.redirect('/?error=An error occurred during login.'); }
});
app.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) { return next(err); } res.redirect('/'); });
});

// --- PAYMENT ROUTES ---
const planDetails = {
    IN: { currency: 'INR', plans: { '5': 7, '9': 15, '49': 100, '99': 500, '499': -1 } },
    US: { currency: 'USD', plans: { '1': 7, '2': 15, '5': 100, '10': 500, '50': -1 } } 
};

app.post('/create-order', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'You must be logged in.' });
    const { amount, gateway } = req.body;
    
    const ip = req.ip;
    let country = (geoip.lookup(ip) && geoip.lookup(ip).country === 'IN') || IS_LOCAL_TESTING_INDIA ? 'IN' : 'US';
    const countryPlans = country === 'IN' ? planDetails['IN'] : planDetails['US'];
    const credits = countryPlans.plans[amount];

    if (gateway === 'razorpay') {
        // --- Razorpay (IN) Logic ---
        const inrAmount = country === 'US' ? amount * 80 : amount; // Convert USD to INR
        try {
            const options = { 
                amount: inrAmount * 100, 
                currency: "INR", 
                notes: { userId: req.user.id, credits, originalAmount: amount } 
            };
            const order = await razorpay.orders.create(options);
            return res.json({ gateway: 'razorpay', order }); 
        } catch (error) { 
            console.error("Razorpay Error:", error);
            return res.status(500).json({ error: 'Error creating Razorpay order.' }); 
        }
    } else if (gateway === 'paypal') {
        // --- PayPal (US/International) Logic ---
        const create_payment_json = {
            "intent": "sale",
            "payer": { "payment_method": "paypal" },
            "redirect_urls": {
                "return_url": `${process.env.BASE_URL}/paypal-checkout?success=true&amount=${amount}&credits=${credits}`,
                "cancel_url": `${process.env.BASE_URL}/paypal-checkout?success=false`
            },
            "transactions": [{
                "item_list": {
                    "items": [{
                        "name": `${credits} Credits`,
                        "sku": "CREDIT_PACK",
                        "price": amount.toString(),
                        "currency": "USD",
                        "quantity": "1"
                    }]
                },
                "amount": { "currency": "USD", "total": amount.toString() },
                "description": `Purchase of ${credits} credits for Mind Reader Game.`
            }]
        };

        return new Promise((resolve) => {
            paypal.payment.create(create_payment_json, function (error, payment) {
                if (error) {
                    console.error("PayPal Create Error:", error.response);
                    return res.status(500).json({ error: 'PayPal payment creation failed.' });
                } else {
                    for(let i = 0; i < payment.links.length; i++) {
                        if(payment.links[i].rel === 'approval_url') {
                            // Send the approval URL back to the client
                            return res.json({ gateway: 'paypal', approvalUrl: payment.links[i].href });
                        }
                    }
                    return res.status(500).json({ error: 'Could not find PayPal approval URL.' });
                }
            });
        });
    }
});

// PayPal Execution Route
app.get('/paypal-checkout', async (req, res) => {
    const { success, paymentId, token, PayerID, amount, credits } = req.query;

    if (success === 'false') {
        return res.redirect('/?error=PayPal payment cancelled.');
    }

    if (!paymentId || !PayerID || !req.user) {
        return res.redirect('/?error=PayPal data missing or user not logged in.');
    }

    const execute_payment_json = { payer_id: PayerID, transactions: [{ amount: { currency: "USD", total: amount } }] };

    paypal.payment.execute(paymentId, execute_payment_json, async function (error, payment) {
        if (error) {
            console.error("PayPal Execution Error:", error.response);
            return res.redirect('/?error=PayPal payment execution failed.');
        } else {
            try {
                const creditValue = parseInt(credits);
                const isUnlimited = creditValue === -1;
                
                if (isUnlimited) {
                    await db.query('UPDATE users SET has_unlimited = TRUE WHERE id = ?', [req.user.id]);
                } else {
                    await db.query('UPDATE users SET credits = credits + ? WHERE id = ?', [creditValue, req.user.id]);
                }
                return res.redirect('/?payment=success&message=Credits Added via PayPal!');
            } catch (dbError) {
                console.error('DB Error after PayPal:', dbError);
                return res.redirect('/?error=Payment successful but failed to update credits.');
            }
        }
    });
});

// Removed /checkout route as it handled Braintree transactions.

// --- GAME LOGIC ROUTE ---
app.post('/play-game', async (req, res) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'You must be logged in.' });
    try {
        const [[user]] = await db.query('SELECT credits, has_unlimited FROM users WHERE id = ?', [req.user.id]);
        if (user.has_unlimited) { return res.json({ success: true, newCredits: 'Unlimited' }); }
        if (user.credits > 0) {
            await db.query('UPDATE users SET credits = credits - 1 WHERE id = ?', [req.user.id]);
            const newCredits = user.credits - 1;
            if(req.user) req.user.credits = newCreditValue;
            return res.json({ success: true, newCredits: newCredits });
        } else {
            return res.json({ success: false, message: 'You have no credits left.' });
        }
    } catch (error) {
        console.error('Error deducting credit:', error);
        return res.status(500).json({ success: false, message: 'A server error occurred.' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
