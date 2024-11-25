// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";
// import functions
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC2TrLkAitBh4qsBVflQjf-jT9ZlcKpnLk",
  authDomain: "nu-result-scraper.firebaseapp.com",
  databaseURL: "https://nu-result-scraper-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nu-result-scraper",
  storageBucket: "nu-result-scraper.firebasestorage.app",
  messagingSenderId: "461283522573",
  appId: "1:461283522573:web:244ed97eeba9b123eafd44",
  measurementId: "G-LTC9VCWXR3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth();
const database = getDatabase(app);
const provider = new GoogleAuthProvider();
const analytics = getAnalytics(app);
const functions = getFunctions(app, "asia-south2");

// Export everything from this module
export { app, auth, database, provider, analytics, functions, httpsCallable, signInWithPopup, onAuthStateChanged, signOut, ref, set, onValue };
