// config.js
import { initializeApp }         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth,
         GoogleAuthProvider }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase }            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCC7K_eIh4NYLhuSBDbAg5sGmpS3N6Lrxk",
  authDomain:        "project-ceb4850b-2bc1-4e8b-97a.firebaseapp.com",
  databaseURL:       "https://project-ceb4850b-2bc1-4e8b-97a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "project-ceb4850b-2bc1-4e8b-97a",
  storageBucket:     "project-ceb4850b-2bc1-4e8b-97a.firebasestorage.app",
  messagingSenderId: "1059135413776",
  appId:             "1:1059135413776:web:ab688ffd92792f21c83495"
};

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const db       = getDatabase(app);
export const provider = new GoogleAuthProvider();