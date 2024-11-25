import { app, auth, functions, database, httpsCallable, provider, analytics, signInWithPopup, onAuthStateChanged, signOut, ref, set, onValue } from './auth.js';

let userId = null;
let idToken = null;
let email = null;
let startingTime = null;
let runtimeDurationSeconds = null;
let runtimeElapsedChecker = null;

// Form elements
const form = document.getElementById('scraper-form');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const resultsContainer = document.getElementById('results-container');
const sheetLink = document.getElementById('sheet-link');
const statusText = document.getElementById('status-text');
const errorsParagraph = document.getElementById("errors-text");

// Semester configurations
const semesters = {
  "CSE": {
    "5611": "[CSE] 1st Semester",
    "5612": "[CSE] 2nd Semester",
    "5613": "[CSE] 3rd Semester",
    "5614": "[CSE] 4th Semester",
    "5615": "[CSE] 5th Semester",
    "5616": "[CSE] 6th Semester",
    "5617": "[CSE] 7th Semester",
    "5618": "[CSE] 8th Semester",
    "5610": "[CSE] Final",
    "751": "[MCSE] 1st Semester",
    "752": "[MCSE] 2nd Semester",
    "750": "[MCSE] Final",
  },
  "ECE": {
    "5621": "[ECE] 1st Semester",
    "5622": "[ECE] 2nd Semester",
    "5623": "[ECE] 3rd Semester",
    "5624": "[ECE] 4th Semester",
    "5625": "[ECE] 5th Semester",
    "5626": "[ECE] 6th Semester",
    "5627": "[ECE] 7th Semester",
    "5628": "[ECE] 8th Semester",
    "C": "[ECE] Consolidated Result",
  },
  "BBA": {
    "5601": "[BBA] 1st Semester",
    "5602": "[BBA] 2nd Semester",
    "5603": "[BBA] 3rd Semester",
    "5604": "[BBA] 4th Semester",
    "5605": "[BBA] 5th Semester",
    "5606": "[BBA] 6th Semester",
    "5607": "[BBA] 7th Semester",
    "5608": "[BBA] 8th Semester",
    "5600": "[BBA] Final",
    "C": "[BBA] Consolidated Result",
  }
};

// Department change handler
document.getElementById("department").addEventListener("change", function() {
  const department = this.value;
  const examCodeSelect = document.getElementById("exam_code");
  examCodeSelect.disabled = false;
  examCodeSelect.innerHTML = "";
  
  const semestersForDepartment = semesters[department];
  for (const [key, value] of Object.entries(semestersForDepartment)) {
    const option = document.createElement("option");
    option.value = key;
    option.text = value;
    examCodeSelect.appendChild(option);
  }
});

// Function to validate form data
function validateFormData(formData) {
  if (!formData.department || !semesters[formData.department]) {
    return "Please select a valid department";
  }

  if (!formData.exam_code || !semesters[formData.department][formData.exam_code]) {
    return "Please select a valid semester";
  }

  if (!formData.regNumLowerLimit || !formData.regNumUpperLimit) {
    return "Please enter both registration number limits";
  }

  if (parseInt(formData.regNumLowerLimit) >= parseInt(formData.regNumUpperLimit)) {
    return "Lower limit must be less than upper limit";
  }

  if (!formData.exam_year) {
    return "Please enter an exam year";
  }

  return null; // Return null if validation passes
}

// Checks if the specified duration has elapsed since the starting time
function checkIfTimeElapsedPeriodic(startingTime, duration) {
  // Ensure startingTime is a timestamp in milliseconds
  const startTimeMs = startingTime instanceof Date ? startingTime.getTime() : startingTime;

  // Set up the interval to check every 2 seconds
  const intervalId = setInterval(() => {
    const currentTime = Date.now();
    const elapsed = currentTime - startTimeMs;
    console.log(currentTime, startTimeMs, elapsed);

    console.log(`Elapsed: ${elapsed} ms`);

    if (elapsed >= duration) {
      console.log("Duration elapsed!");
      alert("Error: Maximum scraping time elapsed!");
      clearInterval(intervalId); // Automatically stop when the duration is reached
    }
  }, 2000); // Check every 2 seconds

  // Return an object with a stop method for manual control
  return {
    stop: () => {
      clearInterval(intervalId);
      console.log("Manual stop invoked.");
    },
  };
}

// Function to update UI based on job status
function updateUIStatus(status, message = '') {
  switch (status) {
    case 'running':
      disableForm(form, true);
      progressContainer.classList.remove('hidden');
      resultsContainer.classList.add('hidden');
      statusText.textContent = 'Scraping in progress...';
      statusText.className = 'text-blue-600';
      break;
    case 'completed':
      disableForm(form, false);
      progressContainer.classList.add('hidden');
      resultsContainer.classList.remove('hidden');
      statusText.textContent = 'Scraping task ended!';
      statusText.className = 'text-green-600';
      alert(statusText.textContent);
      break;
    case 'error':
      disableForm(form, false);
      progressContainer.classList.add('hidden');
      statusText.textContent = `Error: ${message}`;
      statusText.className = 'text-red-600';
      alert(statusText.textContent);
      break;
  }
}

// https://stackoverflow.com/a/57448862/12804377
const escapeHTML = str => str.replace(/[&<>'"]/g, 
  tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag])
);

function disableForm(formElement, disable=true) {
  var elements = formElement.elements;
  for (var i = 0, len = elements.length; i < len; ++i) {
    elements[i].disabled = disable;
  }
  let submitBtn = document.querySelector("button[type='submit']");
  if (submitBtn) {
    if (disable) {
      submitBtn.classList.add("opacity-50");
      submitBtn.classList.add("cursor-not-allowed");
    } else {
      submitBtn.classList.remove("opacity-50");
      submitBtn.classList.remove("cursor-not-allowed");
    }
  }
}


// Form submission handler
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    // Reset UI
    progressBar.style.width = '0%';
    progressText.textContent = '';
    resultsContainer.classList.add('hidden');
    statusText.textContent = '';
    errorsParagraph.innerHTML = '';

    // Get form data
    const formData = Object.fromEntries(new FormData(form));
    // Disable form
    disableForm(form, true);
    formData.semester_name = semesters[formData.department][formData.exam_code];
    formData.userId = userId;
    formData.idToken = idToken;
    formData.email = email;

    // console.log(userId, idToken, email);

    // Validate form data
    const validationError = validateFormData(formData);
    if (validationError) {
      throw new Error(validationError);
    }

    // Get the Cloud Function
    const scrapeResults = httpsCallable(functions, 'scrapeResults123');

    // Call the function and get initial response
    const result = await scrapeResults(formData);
    const { jobId } = result.data;

    // Update UI to show progress
    updateUIStatus('running');

    // Listen for job updates
    const jobRef = ref(database, 'users/' + userId + '/jobs/' + jobId);
    onValue(jobRef, (snapshot) => {
      const jobData = snapshot.val();
      if (!jobData) return;

      const { progress, total, status, sheetUrl, error, errors, createdAt, runtimeDuration } = jobData;

      startingTime = createdAt;
      runtimeDurationSeconds = runtimeDuration;

      try {
        runtimeElapsedChecker.stop();
      } catch {}
      runtimeElapsedChecker = checkIfTimeElapsedPeriodic(startingTime, runtimeDurationSeconds);

      // Update progress
      if (progress !== undefined && total !== undefined) {
        const percentage = Math.min((progress / total) * 100, 100);
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${progress}/${total} records processed`;
      }

      // Check error messages
      console.log(errors, typeof(errors));
      if (errors !== undefined && Object.keys(errors).length > 0 ) {
        let htmlString = "<code>";
        for(let error of Object.values(errors)) {
          htmlString += escapeHTML(error.error);
          if(error.url){
            htmlString += ` <a href='${error.url}' target='_blank'>Try YourSelf</a>`;
          }
          htmlString += " <br/>";
        }
        htmlString += "</code>";
        errorsParagraph.innerHTML = htmlString;
      } else {
        errorsParagraph.innerHTML = "";
      }

      // Handle job completion or error
      if (status === 'completed' && sheetUrl) {
        // jobRef.off(); // Stop listening for updates
        updateUIStatus('completed');
        sheetLink.href = sheetUrl;
      } else if (status === 'error') {
        // jobRef.off(); // Stop listening for updates
        updateUIStatus('error', error || 'Unknown error occurred');
      }
      runtimeElapsedChecker.stop();
    });

  } catch (error) {
    console.error('Error:', error);
    updateUIStatus('error', error.message || 'An unexpected error occurred');
    disableForm(form, false);
  }
});

// Optional: Add authentication state observer
onAuthStateChanged(auth, (user) => {
  if (user) {
    userId = user.uid;
    user.getIdToken().then((token) => {
      idToken = token;
    });
    email = user.email;
    form.classList.remove('hidden');
    document.getElementById('login-required').classList.add('hidden');
  } else {
    userId = null;
    idToken = null;
    email = null;
    form.classList.add('hidden');
    document.getElementById('login-required').classList.remove('hidden');
  }
});
