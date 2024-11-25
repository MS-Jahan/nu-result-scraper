const functions = require("firebase-functions/v2");
const {google} = require("googleapis");
const cheerio = require("cheerio");
const axios = require("axios");
const admin = require("firebase-admin");
const axiosRetry = require("axios-retry").default;
const http = require("http");

// const agent = new http.Agent({keepAlive: true});

/* eslint-disable max-len, require-jsdoc */

// Firebase Admin Initialization
admin.initializeApp();

let webProxyUrl = "";
let webProxyApiToken = "";

// Persistent HTTP Agent for Axios
const httpAgent = new http.Agent({keepAlive: true});
const axiosInstance = axios.create({
  httpAgent,
  timeout: 30000,
});

// Retry Logic with Exponential Backoff
axiosRetry(axiosInstance, {
  retries: 3, // Number of retries
  retryDelay: axiosRetry.exponentialDelay, // Exponential backoff delay
  retryCondition: (error) =>
    error.code === "ECONNABORTED" || error.response?.status >= 500, // Retry for timeout or server errors
});

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isStringAnInteger = (str) => /^\d+$/.test(str);
const isAllowedDepartment = (department) => ["CSE", "ECE", "BBA"].includes(department);
const isAllowedRegistrationRange = (lowerLimit, upperLimit) =>
  isStringAnInteger(lowerLimit) &&
  isStringAnInteger(upperLimit) &&
  parseInt(lowerLimit) < parseInt(upperLimit);

const validateFormData = (formData) => {
  // Validate department
  if (!formData.department.trim()) return "Department is required!";
  if (!isAllowedDepartment(formData.department.trim())) return "Invalid department name!";

  // Validate registration number range
  if (!formData.regNumLowerLimit || !formData.regNumUpperLimit) {
    return "Both registration number limits are required!";
  }
  if (
    !isStringAnInteger(formData.regNumLowerLimit.trim()) ||
    !isStringAnInteger(formData.regNumUpperLimit.trim())
  ) {
    return "Registration numbers must be valid integers!";
  }
  if (!isAllowedRegistrationRange(formData.regNumLowerLimit, formData.regNumUpperLimit)) {
    return "Invalid registration number range!";
  }
  if (parseInt(formData.regNumLowerLimit) > parseInt(formData.regNumUpperLimit)) {
    return "Lower registration limit cannot be greater than upper limit!";
  }

  // Validate college code (optional param)
  if (formData.college_code.trim() && !isStringAnInteger(formData.college_code.trim())) {
    return "Invalid college code!";
  }

  // Validate exam code
  if (!formData.exam_code.trim()) return "Exam code is required!";
  if (!isStringAnInteger(formData.exam_code.trim())) {
    return "Exam code must be a valid integer!";
  }

  // Validate semester name
  if (!formData.semester_name.trim()) return "Semester name is required!";
  if (!/^\[.+\] \d+(st|nd|rd|th) Semester$/.test(formData.semester_name.trim())) {
    return "Invalid semester name format!";
  }

  // Validate exam year
  if (!formData.exam_year.trim()) return "Exam year is required!";
  if (!/^\d{4}$/.test(formData.exam_year.trim())) {
    return "Exam year must be a valid 4-digit year!";
  }
  const currentYear = new Date().getFullYear();
  if (parseInt(formData.exam_year.trim()) > currentYear) {
    return "Exam year cannot be in the future!";
  }

  // Validate email
  if (!formData.email.trim()) return "Email is required!";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
    return "Invalid email format!";
  }

  return "OK";
};

const runtimeDuration = 50 * 60; // 50 minutes

exports.scrapeResults123 = functions.https.onCall({
  timeoutSeconds: runtimeDuration,
  region: "asia-south2",
  memory: "2GiB",
}, async (req, context) => {
  const data = req.data;
  const userId = data.userId;
  webProxyUrl = process.env.WEB_PROXY_URL;
  webProxyApiToken = process.env.WEB_PROXY_API_TOKEN;

  try {
    // Authenticate User
    await admin.auth().verifyIdToken(data.idToken);
  } catch (error) {
    console.error("Authentication Error:", error);
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  // Validate Form Data
  const validationResult = validateFormData(data);
  if (validationResult !== "OK") {
    throw new functions.https.HttpsError("invalid-argument", validationResult);
  }

  // Initialize Job in Realtime Database
  const jobId = admin.database().ref(`users/${userId}/jobs`).push().key;
  const jobRef = admin.database().ref(`users/${userId}/jobs/${jobId}`);
  const historyId = admin.database().ref(`users/${userId}/history`).push().key;
  const historyRef = admin.database().ref(`users/${userId}/history/${historyId}`);

  const total = parseInt(data.regNumUpperLimit) - parseInt(data.regNumLowerLimit) + 1;
  const createdAt = admin.database.ServerValue.TIMESTAMP;
  await jobRef.set({
    progress: 0,
    total,
    status: "running",
    sheetUrl: "",
    createdAt: createdAt,
    userEmail: data.email,
    runtimeDuration,
  });

  data.sheetName = `NU ${data.semester_name.replace("[", "").replace("]", "")} ${data.exam_year} Result`;
  await historyRef.set({
    sheetUrl: "",
    sheetName: data.sheetName,
    createdAt,
  });

  // Start Background Processing
  processScraping(data, jobId, userId).catch((error) => {
    console.error("Background Processing Error:", error);
    jobRef.child("errors").push({
      error: error.message,
      stackTrace: error.stack,
      timestamp: admin.database.ServerValue.TIMESTAMP,
    });
  });

  return {success: true, jobId, message: "Scraping started successfully"};
});

const processRegistrationNumber = async (data, regNum, jobRef, results) => {
  let retry = 2;
  while (retry >= 1) {
    let url;
    try {
      if (data.department === "CSE") {
        url = `http://result.nu.ac.bd/cse/cse_result.php?roll_number=&reg_no=${regNum}&exm_code=${data.exam_code}&exam_year=${data.exam_year}`;
      } else if (data.department === "ECE") {
        url = `http://result.nu.ac.bd/ece/ece_result.php?roll_number=&reg_no=${regNum}&exm_code=${data.exam_code}&exam_year=${data.exam_year}`;
      } else if (data.department === "BBA") {
        url = `http://result.nu.ac.bd/bba/individual_result_show.php?roll_number=${regNum}&semester=${data.exam_code}&exam_year=${data.exam_year}`;
      }

      const postData = {url, token: webProxyApiToken};
      const response = await axiosInstance.post(
          webProxyUrl,
          postData,
      );

      const html = response.data;
      if (!html || html.includes("Error")) {
        const errMessage = `Result of REG ${regNum} was not found!`;
        console.log(errMessage);
        await jobRef.child("errors").push({
          error: errMessage,
          stackTrace: errMessage,
          timestamp: admin.database.ServerValue.TIMESTAMP,
        });
        break;
      }

      const $ = cheerio.load(html);
      const resultData = parseHtmlToResultData($, data, regNum);
      if (resultData) {
        results.push(resultData);
      }
      break;
    } catch (error) {
      retry--;
      console.error(`Retrying REG ${regNum} due to error:`, error, url);
      await jobRef.child("errors").push({
        error: `Retrying REG ${regNum} due to error: ${error.message}}`,
        url,
        stackTrace: error.stack,
        timestamp: admin.database.ServerValue.TIMESTAMP,
      });
    }
    await sleep(1000); // Optional delay before retrying
  }
};


async function processScraping(data, jobId, userId, historyId) {
  const jobRef = admin.database().ref(`users/${userId}/jobs/${jobId}`);
  const historyRef = admin.database().ref(`users/${userId}/history/${historyId}`);

  const results = [];
  try {
    // Google Sheets and Drive Clients
    const auth = new google.auth.GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });
    const sheets = google.sheets({version: "v4", auth: await auth.getClient()});
    const drive = google.drive({version: "v3", auth});
    // Create Spreadsheet
    const sheetName = data.sheetName;
    const spreadsheet = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: sheetName,
        },
      },
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Set Permissions for Spreadsheet
    await drive.permissions.create({
      fileId: spreadsheetId,
      resource: {role: "reader", type: "anyone"},
    });

    // Add a specific email as an editor
    await drive.permissions.create({
      fileId: spreadsheetId,
      resource: {
        role: "writer", // Editor role
        type: "user",
        emailAddress: data.email,
      },
    });

    // Update Job with Sheet URL
    await jobRef.update({sheetUrl});

    // Scraping Logic
    const batchSize = 10; // Adjust batch size based on server limits
    const regNumRange = Array.from(
        {length: parseInt(data.regNumUpperLimit) - parseInt(data.regNumLowerLimit) + 1},
        (_, i) => parseInt(data.regNumLowerLimit) + i,
    );

    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(2);

    for (let i = 0; i < regNumRange.length; i += batchSize) {
      const batch = regNumRange.slice(i, i + batchSize);
      await Promise.all(batch.map((regNum) => limit(() => processRegistrationNumber(data, regNum, jobRef, results))));
      // Update Job Progress
      await jobRef.update({progress: results.length});
    }


    // Write Results to Spreadsheet
    if (results.length > 0) {
      await writeResultsToSheet(sheets, spreadsheetId, results);
    }

    const completedAt = admin.database.ServerValue.TIMESTAMP;
    // Update Job as Completed
    await jobRef.update({
      status: "completed",
      completedAt: completedAt,
    });

    // Update history
    await historyRef.update({
      completedAt: completedAt,
      department: data.department,
      semester: data.semester_name,
      examYear: data.exam_year,
      sheetUrl,
      sheetName,
      recordsProcessed: results.length,
    });
  } catch (error) {
    console.error("Scraping Error:", error);
    const completedAt = admin.database.ServerValue.TIMESTAMP;
    await jobRef.child("errors").push({
      error: error.message,
      stackTrace: error.stack,
      timestamp: completedAt,
    });
    await jobRef.update({
      status: "error",
      completedAt: completedAt,
      totalResults: results.length,
    });
    // Update history
    await historyRef.update({
      completedAt: completedAt,
      department: data.department,
      semester: data.semester_name,
      examYear: data.exam_year,
      error: error.message,
      recordsProcessed: results.length,
    });
    throw new functions.https.HttpsError("internal", "Failed to scrape results", error);
  }
}

function parseHtmlToResultData($, data, regNum) {
  const tables = $("table");
  const firstTable = tables.eq(2);

  // Extract basic information
  const name = firstTable.find("tr").find("td").eq(1).text().trim();
  let gpa; let collegeCodeText;

  if (["CSE", "ECE"].includes(data.department)) {
    gpa = firstTable.find("tr")
        .eq(6).find("td").eq(1).text().trim();
    collegeCodeText = firstTable.find("tr")
        .eq(3).find("td").eq(1).text().trim();
  } else {
    gpa = firstTable.find("tr")
        .eq(5).find("td").eq(1).text().trim();
    collegeCodeText = firstTable.find("tr")
        .eq(1).find("td").eq(1).text().trim();
  }

  // Check college code if specified
  if (data.college_code) {
    const match = collegeCodeText.match(/\[(\d+)\]/);
    const collegeCode = match ? match[1] : null;
    if (collegeCode !== data.college_code) return false;
  }

  // Extract subject results
  const secondTable = tables.eq(3);
  const rows = secondTable.find("tr");
  const resultData = {
    "Name": name,
    "REG": regNum,
    "GPA": gpa,
    "College Name": collegeCodeText,
  };

  for (let i = 2; i < rows.length; i++) {
    const key = rows.eq(i).find("td").eq(1).text().trim();
    const value = ["CSE", "ECE"].includes(data.department) ?
        rows.eq(i).find("td").eq(3).text().trim() :
        rows.eq(i).find("td").eq(2).text().trim();
    resultData[key] = value;
  }

  console.log(resultData);
  return resultData;
}

async function writeResultsToSheet(sheets, spreadsheetId, results) {
  if (results.length === 0) return;

  // Sort the data
  const headers = Object.keys(results[0]);
  const sortedResults = [...results].sort((a, b) => {
    const gpaA = parseFloat(a.GPA);
    const gpaB = parseFloat(b.GPA);

    if (isNaN(gpaA) && isNaN(gpaB)) return 0;
    if (isNaN(gpaA)) return 1; // Place invalid GPA at the bottom
    if (isNaN(gpaB)) return -1; // Place valid GPA above invalid GPA

    return gpaB - gpaA; // Sort descending by GPA
  });

  const values = [headers, ...sortedResults.map((row) => headers.map((header) => row[header]))];

  // Write data to the sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    resource: {values},
  });

  // Format the header row to bold
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          repeatCell: {
            range: {
              startRowIndex: 0,
              endRowIndex: 1, // Only format the header row
              startColumnIndex: 0,
              endColumnIndex: headers.length,
            },
            cell: {
              userEnteredFormat: {
                textFormat: {
                  bold: true,
                },
              },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    },
  });
}

/* eslint-disable max-len, require-jsdoc */
