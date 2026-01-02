document.addEventListener('DOMContentLoaded', () => {
    // --- Section 1: All Variable Declarations & Initializations ---
    const isUserLoggedIn = document.querySelector('.welcome-message');
    
    // Modals
    const authModal = document.getElementById('authModal');
    const rechargeModal = document.getElementById('rechargeModal');
    const sideMenu = document.getElementById('sideMenu');
    const aboutModal = document.getElementById('aboutModal');
    const disclaimerModal = document.getElementById('disclaimerModal');
    const paymentMethodModal = document.getElementById('paymentMethodModal'); // NEW

    // Custom Alert Variables (NEW)
    const customAlertModal = document.getElementById('customAlertModal');
    const customAlertTitle = document.getElementById('customAlertTitle');
    const customAlertMessage = document.getElementById('customAlertMessage');
    const customAlertOkBtn = document.getElementById('customAlertOkBtn');


    // Buttons that open things
    const loginButton = document.getElementById('loginButton');
    const buyCreditsBtn = document.getElementById('buyCreditsBtn');
    const menuBtn = document.getElementById('menuBtn');
    const footerAboutLink = document.getElementById('footerAboutLink');
    const footerDisclaimerLink = document.getElementById('footerDisclaimerLink');
    const sideMenuAboutLink = document.getElementById('sideMenuAboutLink');
    const sideMenuDisclaimerLink = document.getElementById('sideMenuDisclaimerLink');
    
    // A robust way to select all close buttons
    const allCloseButtons = document.querySelectorAll('.close-button');

    // Auth Modal specifics
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Recharge Modal specifics
    const plansContainer = document.querySelector('.plans-container');
    const finalPaypalBtn = document.getElementById('finalPaypalBtn'); // NEW

    // Game elements
    const steps = [
        "Close your eyes and think of a number.", "Now, Multiply it by 2.", "Now, add a random even number to your total.", "Now, divide your total by 2.", "Finally, subtract the original number you imagined.", "The number in your mind is..."
    ];
    let currentStep = -1;
    let isMuted = false;
    const instructions = document.getElementById('instructions');
    const nextButton = document.getElementById('nextButton');
    const muteButton = document.getElementById('muteButton');
    const magicSound = document.getElementById('magicSound');
    const finalMusic = document.getElementById('finalMusic');
    let random = 0;
    
    // --- NEW FUNCTION: Custom Alert Handler ---
    function customAlert(title, message, callback = () => {}) {
        if (!customAlertModal) {
            window.alert(`${title}: ${message}`);
            callback();
            return;
        }
        
        customAlertTitle.textContent = title;
        customAlertMessage.textContent = message;
        customAlertModal.style.display = 'flex';

        const handleOk = () => {
            customAlertModal.style.display = 'none';
            customAlertOkBtn.removeEventListener('click', handleOk);
            callback();
        };

        customAlertOkBtn.addEventListener('click', handleOk);
    }

    // --- Section 2: Modal and Menu Logic ---
    if (loginButton) loginButton.addEventListener('click', () => { if(authModal) authModal.style.display = 'flex'; });
    // CHANGE: Open Recharge Modal first for all users
    if (buyCreditsBtn) buyCreditsBtn.addEventListener('click', () => { 
        populatePaymentPlans();
        if(rechargeModal) rechargeModal.style.display = 'flex';
    });

    if (menuBtn) menuBtn.addEventListener('click', () => { if(sideMenu) sideMenu.style.width = '250px'; });
    if (footerAboutLink) footerAboutLink.addEventListener('click', (e) => { e.preventDefault(); if(aboutModal) aboutModal.style.display = 'flex'; });
    if (footerDisclaimerLink) footerDisclaimerLink.addEventListener('click', (e) => { e.preventDefault(); if(disclaimerModal) disclaimerModal.style.display = 'flex'; });
    if (sideMenuAboutLink) sideMenuAboutLink.addEventListener('click', (e) => { e.preventDefault(); if(aboutModal) aboutModal.style.display = 'flex'; if(sideMenu) sideMenu.style.width = '0'; });
    if (sideMenuDisclaimerLink) sideMenuDisclaimerLink.addEventListener('click', (e) => { e.preventDefault(); if(disclaimerModal) disclaimerModal.style.display = 'flex'; if(sideMenu) sideMenu.style.width = '0'; });

    allCloseButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modal = button.closest('.modal-overlay, .side-menu');
            if (modal) {
                if(modal.classList.contains('side-menu')) {
                    modal.style.width = '0';
                } else {
                    modal.style.display = 'none';
                }
            }
        });
    });
    
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal-overlay')) {
            event.target.style.display = 'none';
        }
    });
    
    tabLinks.forEach(tab => {
        tab.addEventListener('click', () => {
            tabLinks.forEach(item => item.classList.remove('active'));
            tabContents.forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- Section 3: Smart Payment Logic (Razorpay + Direct PayPal Integration) ---
    
    // Store selected international amount temporarily
    let selectedInternationalAmount = null;

    function populatePaymentPlans() {
        const planDetails = {
            IN: { currency: '₹', plans: [{ amount: 5, credits: 7 }, { amount: 9, credits: 15 }, { amount: 49, credits: 100, p: true }, { amount: 99, credits: 500 }, { amount: 499, credits: 'Unlimited', v: true }] },
            US: { currency: '$', plans: [{ amount: 1, credits: 7 }, { amount: 2, credits: 15 }, { amount: 5, credits: 100, p: true }, { amount: 10, credits: 500 }, { amount: 50, credits: 'Unlimited', v: true }] }
        };
        const countryConfig = planDetails[userCountry] || planDetails['US'];
        
        // Ensure PayPal button is hidden initially
        if(finalPaypalBtn) finalPaypalBtn.style.display = 'none';
        
        if(plansContainer) plansContainer.innerHTML = '';
        
        countryConfig.plans.forEach(plan => {
            const card = document.createElement('div');
            card.className = 'plan-card';
            if (plan.p) card.classList.add('popular');
            if (plan.v) card.classList.add('vip');
            card.dataset.amount = plan.amount;
            card.dataset.credits = plan.credits; // Store credits too
            // International users see USD ($), Indian users see INR (₹)
            card.innerHTML = `Buy ${plan.credits} Credits for ${countryConfig.currency}${plan.amount}` + (plan.p ? `<span>Most Popular</span>` : '');
            if(plansContainer) plansContainer.appendChild(card);
        });

        document.querySelectorAll('.plan-card').forEach(card => card.addEventListener('click', handlePlanClick));
    }
    
    // PayPal Button Listener (Only for International/US users)
    if (finalPaypalBtn) {
        finalPaypalBtn.addEventListener('click', async () => {
            if (!selectedInternationalAmount) {
                return customAlert("Error", "Please select a plan first.");
            }

            // Close the current modal and start PayPal flow
            if (rechargeModal) rechargeModal.style.display = 'none';

            // Start PayPal payment creation process
            const response = await fetch('/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: selectedInternationalAmount,
                    gateway: 'paypal'
                })
            });
            const data = await response.json();

            if (data.error) {
                return customAlert("PayPal Error", data.error);
            }
            if (data.gateway === 'paypal' && data.approvalUrl) {
                // Redirect user to PayPal for approval
                window.location.href = data.approvalUrl;
            }
        });
    }

    async function handlePlanClick(event) {
        const card = event.currentTarget;
        const amount = card.dataset.amount;

        if (userCountry === 'IN') {
            // --- Razorpay Flow (For Indian Users) ---
            const response = await fetch('/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, gateway: 'razorpay' })
            });
            const data = await response.json();

            if (data.error) { 
                return customAlert("Error", data.error); 
            }
            
            if (data.gateway === 'razorpay') {
                if (rechargeModal) rechargeModal.style.display = 'none'; // Close the plans modal before payment
                
                const options = {
                    key: razorpayKeyId, // Your LIVE Razorpay Key ID
                    amount: data.order.amount, 
                    currency: data.order.currency, // INR
                    name: "Mind Reader Game", 
                    order_id: data.order.id,
                    handler: (response) => { 
                        window.location.href = '/?payment=success&message=Credits Added!'; 
                    },
                    prefill: { email: userEmail }
                };
                const rzp = new Razorpay(options);
                rzp.open();
            } 
        } else {
             // --- PayPal Flow (For International Users) ---
             selectedInternationalAmount = amount;
             
             // Hide all plans and show the PayPal button
             if(plansContainer) plansContainer.style.display = 'none';
             if(finalPaypalBtn) finalPaypalBtn.style.display = 'block';
             
             // Optional: Update button text with amount
             finalPaypalBtn.textContent = `Pay $${amount} with PayPal`;
        }
    }
    
    // --- Section 4: Game Logic ---
    async function handleNextStep() {
        const creditDisplay = document.getElementById('creditDisplay');
        if (currentStep === -1) {
            if (isUserLoggedIn) {
                const response = await fetch('/play-game', { method: 'POST' });
                const data = await response.json();
                if (data.success) {
                    if (creditDisplay) creditDisplay.textContent = `Your Credits: ${data.newCredits}`;
                    currentStep++;
                    updateGameUI();
                } else {
                    populatePaymentPlans();
                    if (rechargeModal) rechargeModal.style.display = 'flex';
                }
            } else {
                const hasPlayed = localStorage.getItem('mindReaderFreePlay');
                if (hasPlayed) {
                    if (authModal) authModal.style.display = 'flex';
                } else {
                    localStorage.setItem('mindReaderFreePlay', 'true');
                    currentStep++;
                    updateGameUI();
                }
            }
        } else {
            currentStep++;
            updateGameUI();
        }
    }
    
    function updateGameUI() {
        if (currentStep >= steps.length) {
            currentStep = -1;
            instructions.textContent = "Press \"Start\" to begin.";
            if (nextButton.querySelector('span')) nextButton.querySelector('span').textContent = "Start";
            instructions.classList.remove('final-animation');
            return;
        }
        if (nextButton.querySelector('span')) nextButton.querySelector('span').textContent = 'Next';
        if (currentStep === 2) {
            random = getRandomEvenNumber();
            instructions.textContent = `Now, add ${random} to your total.`;
        } else if (currentStep === steps.length - 1) {
            const magic = random / 2;
            instructions.innerHTML = `<span class="final-animation">The Number in Your Mind is ${magic}!</span>`;
            if (!isMuted && finalMusic) finalMusic.play();
            if (nextButton.querySelector('span')) nextButton.querySelector('span').textContent = "Restart";
        } else {
            instructions.textContent = steps[currentStep];
            if (currentStep > 0 && !isMuted && magicSound) magicSound.play();
        }
    }
    function toggleMute() { isMuted = !isMuted; if (document.getElementById('volumeIcon')) document.getElementById('volumeIcon').className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up'; }
    function getRandomEvenNumber() { let num; do { num = Math.floor(Math.random() * 50) * 2; } while (num === 0); return num; }

    // --- Section 5: Initializations ---
    function setRandomBackground() { if(document.getElementById('background-animation')) document.getElementById('background-animation').classList.add('bg-animation-1'); }
    if (nextButton) nextButton.addEventListener('click', handleNextStep);
    if (muteButton) muteButton.addEventListener('click', toggleMute);
    setRandomBackground();
    if (typeof particlesJS === 'function') {
        particlesJS('particles-js', { "particles": { "number": { "value": 40, "density": { "enable": true, "value_area": 800 } }, "color": { "value": "#ffffff" }, "shape": { "type": "circle" }, "opacity": { "value": 0.5, "random": true }, "size": { "value": 2, "random": true }, "line_linked": { "enable": true, "distance": 150, "color": "#ffffff", "opacity": 0.2, "width": 1 }, "move": { "enable": true, "speed": 1, "direction": "none", "out_mode": "out" } }, "interactivity": { "detect_on": "canvas", "events": { "onhover": { "enable": true, "mode": "repulse" }, "onclick": { "enable": false } }, "modes": { "repulse": { "distance": 100 } } }, "retina_detect": true });
    }
});
