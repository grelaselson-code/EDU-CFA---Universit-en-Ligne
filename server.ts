import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import {
  initDatabase,
  dbConfig,
  getUsers,
  findUserByEmail,
  createUser,
  getFormations,
  createFormation,
  enrollInCourse,
  updateModuleProgress,
  getCandidatures,
  createCandidature,
  updateCandidatureStatus,
  getMessages,
  createMessage,
  createPayment,
  getDashboardStats,
  getTimetable,
  createTimetableEvent,
  deleteTimetableEvent,
  getAttendance,
  signAttendance,
  createAttendanceRecord,
  getReceipts,
  createReceipt
} from "./server/db";

// Load configuration
dotenv.config();

const app = express();
const PORT = 3000;

// Set up server-side parsers
app.use(express.json());

// Initialize Gemini SDK with User-Agent and key
const geminiApiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;

if (geminiApiKey) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    console.log("Server side Gemini API client initialized successfully!");
  } catch (err: any) {
    console.error("Gemini API Client init failed:", err.message);
  }
} else {
  console.log("GEMINI_API_KEY missing - chatbot will fallback to automatic response answers.");
}

async function runExpressServer() {
  // Try to connect database (Mongoose MongoDB / Local JSON fallback)
  await initDatabase();

  // --- API ROUTE: Database Status ---
  app.get("/api/db-status", (req, res) => {
    res.json(dbConfig);
  });

  // --- API ROUTE: Auth Register ---
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { nom, prenom, email, telephone, password } = req.body;
      if (!nom || !prenom || !email || !password) {
        return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires (nom, prenom, email, password)." });
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "Cet email est déjà utilisé par un autre compte." });
      }

      const student = await createUser({
        nom,
        prenom,
        email,
        telephone,
        password,
        role: "student"
      });

      // Exclude password on representation
      const { password: _, ...safeUser } = student;
      res.status(201).json({ success: true, user: safeUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Auth Login ---
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Veuillez saisir votre email et mot de passe." });
      }

      const user = await findUserByEmail(email);
      if (!user) {
        return res.status(400).json({ error: "Compte introuvable pour cette adresse email." });
      }

      // Check password (In simple app we directly compare strings, or hash in real prod)
      if (user.password !== password) {
        return res.status(400).json({ error: "Mot de passe incorrect." });
      }

      const { password: _, ...safeUser } = user;
      res.json({ success: true, user: safeUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Formations (Enrollment progression aware) ---
  app.get("/api/formations", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const list = await getFormations(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Create a New Course/Formation ---
  app.post("/api/formations", async (req, res) => {
    try {
      const { titre, description, prix, duree, niveau, image, categorie, modules } = req.body;
      if (!titre) {
        return res.status(400).json({ error: "Le titre de la formation/cours est requis." });
      }
      const item = await createFormation({
        titre,
        description,
        prix,
        duree,
        niveau,
        image,
        categorie,
        modules
      });
      res.status(201).json({ success: true, formation: item });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Enroll course ---
  app.post("/api/formations/enroll", async (req, res) => {
    try {
      const { userId, formationId } = req.body;
      if (!userId || !formationId) {
        return res.status(400).json({ error: "Coordonnées de l'étudiant et de formation requises." });
      }
      await enrollInCourse(userId, Number(formationId));
      res.json({ success: true, message: "Inscription au cours enregistrée avec succès!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Update student course module progress ---
  app.post("/api/formations/update-progress", async (req, res) => {
    try {
      const { userId, formationId, moduleName, progression } = req.body;
      if (!userId || !formationId || !moduleName || progression === undefined) {
        return res.status(400).json({ error: "Paramètres d'avancée de module manquants." });
      }
      await updateModuleProgress(userId, Number(formationId), moduleName, Number(progression));
      res.json({ success: true, message: "Progression du module mise à jour." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Student Applications (Admissions) ---
  app.get("/api/candidatures", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const listing = await getCandidatures(userId);
      res.json(listing);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Submit Student Application ---
  app.post("/api/candidatures", async (req, res) => {
    try {
      const { userId, nom, prenom, email, formation, niveau, lettre, cvUrl } = req.body;
      if (!userId || !nom || !prenom || !email || !formation || !niveau) {
        return res.status(400).json({ error: "Veuillez remplir tous les champs d'admission obligatoires." });
      }
      const item = await createCandidature({
        userId,
        nom,
        prenom,
        email,
        formation,
        niveau,
        lettre,
        cvUrl,
        statut: "en_attente"
      });
      res.status(201).json({ success: true, candidature: item });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Admin updates student admission status ---
  app.patch("/api/candidatures/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { statut } = req.body;
      if (!statut || !['en_attente', 'admis', 'refuse'].includes(statut)) {
        return res.status(400).json({ error: "Statut de mise à jour incorrect (en_attente, admis ou refuse attendu)." });
      }
      const updated = await updateCandidatureStatus(id, statut);
      if (!updated) {
        return res.status(404).json({ error: "Dossier de candidature introuvable." });
      }
      res.json({ success: true, candidature: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Chat message history with a tutor ---
  app.get("/api/messages", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      if (!userId) {
        return res.status(400).json({ error: "Coordonnées de l'utilisateur requises." });
      }
      const list = await getMessages(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Send message & Trigger server side Gemini chatbot response as tutor ---
  app.post("/api/messages", async (req, res) => {
    try {
      const { userId, senderName, senderRole, receiverName, text } = req.body;
      if (!senderName || !receiverName || !text) {
        return res.status(400).json({ error: "Champs de messagerie incomplets." });
      }

      // 1. Store the user's message
      const savedUserMsg = await createMessage({
        senderName,
        senderRole,
        receiverName,
        text
      });

      // 2. Generate tutoring reply (Gemini AI or fallback)
      let aiText = "";

      if (aiClient) {
        try {
          console.log(`Analyzing incoming student request for Gemini tutoring (${receiverName})...`);
          
          let tutorPrompt = "";
          if (receiverName.includes("Martin")) {
            tutorPrompt = `Tu es le Professeur Martin de l'université en ligne UNIV-ONLINE. Tu es un enseignant bienveillant, clair et encourageant, spécialisé en programmation web, React, Node.js et bases de données. Réponds aimablement à l'élève ${senderName} qui t'a écrit: "${text}". Structure ta réponse de manière pédagogique.`;
          } else if (receiverName.includes("Dubois")) {
            tutorPrompt = `Tu es la Professeur Dubois de l'université en ligne UNIV-ONLINE. Tu es une spécialiste en Marketing Digital, SEO/SEM et réseaux sociaux. Réponds amicalement à l'étudiant ${senderName} qui t'a écrit: "${text}".`;
          } else {
            tutorPrompt = `Tu es l'équipe d'administration centrale de l'université en ligne UNIV-ONLINE. Tu réponds de manière courtoise, réactive et professionnelle aux questions d'inscriptions, d'admissions ou de scolarité de l'élève ${senderName} qui demande: "${text}".`;
          }

          const response = await aiClient.models.generateContent({
            model: "gemini-3.5-flash",
            contents: tutorPrompt,
            config: {
              systemInstruction: "Tu es un tuteur universitaire francophone de l'UNIV-ONLINE. Garde tes réponses claires, motivantes, constructives, et limite-toi à 2 ou 3 paragraphes maximum.",
              temperature: 0.7,
            }
          });

          aiText = response.text || "Merci pour votre message ! Je serai ravi de vous accompagner dans vos cours et projets.";
        } catch (geminiErr: any) {
          console.error("Gemini tutoring API generation failed, falling back to heuristic answers:", geminiErr.message);
        }
      }

      // If Gemini fails or isn't configured, do smart heuristics
      if (!aiText) {
        const lower = text.toLowerCase();
        if (receiverName.toLowerCase().includes("martin")) { // Course Help Tutor
          if (lower.includes("react") || lower.includes("js") || lower.includes("framework")) {
            aiText = `Bonjour ${senderName} ! Concernant React, l'approche par composants fonctionnels et les hooks (comme useState et useEffect) est fondamentale. Consultez le premier module, nous y détaillons la synchronisation d'états. Avez-vous une question spécifique ? - Prof. Martin`;
          } else if (lower.includes("exam") || lower.includes("note") || lower.includes("évaluation")) {
            aiText = `Bonjour ${senderName}. Nos évaluations sont basées sur des projets pratiques au fil de l'eau. Pour décrocher votre certificat, vous devez simplement pousser l'ensemble des modules à 100% de progression. Bon courage ! - Prof. Martin`;
          } else {
            aiText = `Bonjour ${senderName} ! C'est une excellente question. En informatique, la clé réside dans la pratique régulière. Je vous suggère de tester notre atelier interactif sur Express. N'hésitez pas si un concept reste flou. - Prof. Martin`;
          }
        } else if (receiverName.toLowerCase().includes("administration")) { // School Admin
          if (lower.includes("admis") || lower.includes("admission") || lower.includes("candidature")) {
            aiText = `Bonjour ${senderName}. Votre dossier est actuellement en cours d'analyse par notre commission pédagogique. Dès sa validation par un administrateur, votre statut changera directement sur le tableau de bord et vous débloquerez l'accès complet. Cordialement, Service Admin.`;
          } else if (lower.includes("tarifs") || lower.includes("paye") || lower.includes("prix") || lower.includes("euro")) {
            aiText = `Bonjour ${senderName}, UNIV-ONLINE propose des modalités de paiement flexibles par carte bancaire. Après chaque transaction, vos droits de scolarité sont ajustés instantanément sur votre espace. Bien cordialement.`;
          } else {
            aiText = `Bonjour ${senderName}, merci pour votre prise de contact. Pour toute assistance immédiate liée à votre inscription ou scolarité générale, l'administration reste présente du lundi au vendredi. Comment puis-je vous guider ?`;
          }
        } else {
          aiText = `Bonjour ${senderName}, merci d'avoir contacté votre tuteur Dubois. Nous analysons votre demande et vous répondons dans les plus brefs délais avec une orientation marketing digital adéquate !`;
        }
      }

      // 3. Store the AI tutor reply
      const savedAiMsg = await createMessage({
        senderName: receiverName,
        senderRole: "tutor",
        receiverName: senderName,
        text: aiText
      });

      res.status(201).json({
        success: true,
        userMessage: savedUserMsg,
        tutorMessage: savedAiMsg
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Aggregated Dashboard Analytics ---
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await getDashboardStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Post course payment (Enrolls too) ---
  app.post("/api/payments", async (req, res) => {
    try {
      const { userId, formationId, amount } = req.body;
      if (!userId || !formationId || !amount) {
        return res.status(400).json({ error: "Paramètres de paiement incomplets." });
      }
      const payRecord = await createPayment({
        userId,
        formationId,
        amount
      });
      res.status(201).json({ success: true, payment: payRecord });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Timetable Events ---
  app.get("/api/timetable", async (req, res) => {
    try {
      const list = await getTimetable();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Add Timetable Event ---
  app.post("/api/timetable", async (req, res) => {
    try {
      const { courseTitle, professorName, dayOfWeek, startTime, endTime, room, color, filiere } = req.body;
      if (!courseTitle || !professorName || !dayOfWeek || !startTime || !endTime) {
        return res.status(400).json({ error: "Champs du cours d'emploi de temps requis." });
      }
      const newEv = await createTimetableEvent({
        courseTitle,
        professorName,
        dayOfWeek,
        startTime,
        endTime,
        room: room || "Salle Virtuelle B",
        color: color || "blue",
        filiere: filiere || "Tous"
      });
      res.status(201).json({ success: true, event: newEv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Delete Timetable Event ---
  app.delete("/api/timetable/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await deleteTimetableEvent(id);
      res.json({ success: deleted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Attendance Records ---
  app.get("/api/attendance", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const list = await getAttendance(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Student Signs Attendance ---
  app.post("/api/attendance/sign", async (req, res) => {
    try {
      const { recordId, timeSigned, status } = req.body;
      if (!recordId) {
        return res.status(400).json({ error: "Identifiant de la feuille de présence requis." });
      }
      const updated = await signAttendance(recordId, timeSigned || new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' UTC', status);
      if (!updated) {
        return res.status(404).json({ error: "Enregistrement de présence introuvable." });
      }
      res.json({ success: true, record: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Direct Create Attendance Record ---
  app.post("/api/attendance", async (req, res) => {
    try {
      const { userId, userName, date, courseTitle, status, signed, timeSigned } = req.body;
      if (!userId || !userName || !courseTitle) {
        return res.status(400).json({ error: "Paramètres de présence erronés." });
      }
      const r = await createAttendanceRecord({
        userId,
        userName,
        date: date || new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
        courseTitle,
        status: status || 'present',
        signed: !!signed,
        timeSigned
      });
      res.status(201).json({ success: true, record: r });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Get Invoices Receipts ---
  app.get("/api/receipts", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const list = await getReceipts(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- API ROUTE: Create Invoice Receipt ---
  app.post("/api/receipts", async (req, res) => {
    try {
      const { paymentId, userId, userName, amount, date, courseTitle, paymentMethod } = req.body;
      if (!userId || !userName || !amount || !courseTitle) {
        return res.status(400).json({ error: "Champs de reçu de facturation incomplets." });
      }
      const r = await createReceipt({
        paymentId: paymentId || 'pay_manual',
        userId,
        userName,
        amount: Number(amount),
        date: date || new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
        courseTitle,
        paymentMethod: paymentMethod || "Virement Scolaire"
      });
      res.status(201).json({ success: true, receipt: r });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite Dev Middleware and Production Static Files ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Single page app router serving
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bound to exact port 3000 on host 0.0.0.0
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-Stack MERN portal server bound and listening on http://localhost:${PORT}`);
  });
}

runExpressServer().catch((error) => {
  console.error("Fatal startup error in Express MERN Server:", error);
});
