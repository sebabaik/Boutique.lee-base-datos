import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, collection, addDoc, getDocs,
             doc, updateDoc, deleteDoc, query, orderBy, where,
             Timestamp, writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    const firebaseConfig = {
      apiKey:            "AIzaSyBwFXyhzOkOhxupjLDDpIpJDFyNcLbMBGg",
      authDomain:        "boutique-lee-base-datos.firebaseapp.com",
      projectId:         "boutique-lee-base-datos",
      storageBucket:     "boutique-lee-base-datos.firebasestorage.app",
      messagingSenderId: "178354963959",
      appId:             "1:178354963959:web:7c5e482fd3807fef385af2"
    };

    const app = initializeApp(firebaseConfig);
    const db  = getFirestore(app);

    window._db         = db;
    window._col        = collection;
    window._add        = addDoc;
    window._get        = getDocs;
    window._doc        = doc;
    window._upd        = updateDoc;
    window._del        = deleteDoc;
    window._q          = query;
    window._ord        = orderBy;
    window._where      = where;
    window._Timestamp  = Timestamp;
    window._writeBatch  = writeBatch;
    window._onSnapshot  = onSnapshot;

    window.addEventListener('load', async () => {
  await loadStock();
  // Leer parámetro ?art= si viene desde un QR externo
  const params = new URLSearchParams(location.search);
  const artParam = params.get('art');
  if (artParam) {
    // Ir a la vista scanner y buscar
    const scanBtn = document.querySelector('.nav-tab:nth-child(2)');
    showView('scanner', scanBtn);
    searchByCode(artParam);
  }
});