// history.js
// import { initializeApp } from "firebase/app";
// import { getAuth, onAuthStateChanged } from "firebase/auth";
// import { getDatabase, ref, onValue } from "firebase/database";

// import everything from auth.js
import { auth, database, provider, analytics, signInWithPopup, onAuthStateChanged, signOut, ref, set, onValue } from './auth.js';
 
// ... Firebase initialization

const historyList = document.getElementById('history-list');

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById('login-required').classList.add('hidden');
    // User is signed in, fetch and display their history
    const userId = user.uid;  // Correctly use user.uid to identify the user.
    const userHistoryRef = ref(database, 'users/' + userId + '/history');

    onValue(userHistoryRef, (snapshot) => {
      const historyData = snapshot.val();
      historyList.innerHTML = ''; // Clear previous history

      if (historyData) {
        for (const jobId in historyData) {
          const job = historyData[jobId];
          const listItem = document.createElement('div'); // Create a div instead of <li>
          listItem.className = 'border p-4 mb-4 rounded-lg shadow-md bg-white';

          const sheetLink = document.createElement('a');
          sheetLink.href = job.sheetUrl;
          sheetLink.target = '_blank';
          sheetLink.rel = 'noopener noreferrer';
          sheetLink.textContent = job.sheetName || `NU Result`;
          sheetLink.className = 'text-blue-500 hover:underline block mb-2';

          let timeInfo;
          if (job.completedAt) {
            const completedDate = new Date(job.completedAt);
            timeInfo = "Time: " + (isNaN(completedDate.getTime()) ? "Invalid Date" : completedDate.toLocaleString());
          } else {
            const createdAt = new Date(job.createdAt);
            timeInfo = `Started at ${(isNaN(createdAt.getTime()) ? "Invalid Date" : createdAt.toLocaleString())} | Currently Running`;
          }
          if (job.error) {
            timeInfo += " | [ERROR]";
          }
          
          const timeInfoElement = document.createElement('p');
          timeInfoElement.className = 'text-gray-600';
          timeInfoElement.textContent = timeInfo;

          listItem.appendChild(timeInfoElement);
          listItem.prepend(sheetLink); // Add the sheet link at the beginning
          historyList.appendChild(listItem);

        }
      } else {
        historyList.innerHTML = '<p>No history found.</p>';
      }
    }, (error) => {
        console.error("Error fetching history:", error);
        historyList.innerHTML = '<p>Error loading history.</p>'; // Display error message
    });


  } else {
    document.getElementById('login-required').classList.remove('hidden');
    // User is signed out, show a message or redirect
        historyList.innerHTML = '<p>Please sign in to view your history.</p>'; // Display message
    }
});
