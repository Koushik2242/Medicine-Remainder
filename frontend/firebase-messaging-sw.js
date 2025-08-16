// frontend/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.6.11/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.11/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAl3B0spaQOMC_1u9gSSgw9MYXJzY0AXQ0",
  authDomain: "coffee-spark-sample-app-993fc.firebaseapp.com",
  projectId: "coffee-spark-sample-app-993fc",
  storageBucket: "coffee-spark-sample-app-993fc.firebasestorage.app",
  messagingSenderId: "26725169104",
  appId: "1:26725169104:web:92866671d13f94fb4a6bd5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Medication Reminder';
  const body  = payload.notification?.body  || '';
  self.registration.showNotification(title, { body });
});
