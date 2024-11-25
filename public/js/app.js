// app.js
import { app, auth, functions, httpsCallable, database, provider, analytics, signInWithPopup, onAuthStateChanged, signOut, ref, set, onValue } from './auth.js';


const signInButton = document.getElementById('sign-in-button');
const signInContainer = document.getElementById('sign-in-container');
const dashboardContainer = document.getElementById('dashboard-container');



// Function to handle sign-in
function signIn() {
    signInWithPopup(auth, provider)
        .then((result) => {
            // The signed-in user info.
            const user = result.user;
            // Redirect to the home/dashboard page.
            window.location.href = 'home.html'; // or use your client-side routing
            console.log('Signed in:', user);
        }).catch((error) => {
            // Handle Errors here.
            const errorCode = error.code;
            const errorMessage = error.message;
            // The email of the user's account used.
            const email = error.customData.email;
            // The AuthCredential type that was used.
            const credential = provider.credentialFromError(error);
            console.error('Sign-in error:', errorCode, errorMessage, email, credential);
            alert('Sign-in error:', errorCode, errorMessage, email, credential);
            // ...
        });
}



signInButton.addEventListener('click', signIn);

onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in, display the dashboard.
        signInContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');



    } else {
        // User is signed out, display the sign-in container.
        signInContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
    }
});
