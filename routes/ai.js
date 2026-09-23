// routes/ai.js
const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

async function callClaude(system, user, history = []) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: [...history, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Claude API error');
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── 1. AI CHATBOT ──────────────────────────────────────────────────────────
// POST /ai/chat
// Body: { message, history: [{role,content}] }
router.post('/chat', isLoggedIn, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const db = require('../config/db');
    const user = req.session.user;

    // Fetch user's live data
    const [[student]] = user.role === 'student'
      ? await db.query('SELECT u.*, r.room_number FROM users u LEFT JOIN room_allocations ra ON u.id=ra.student_id AND ra.status="active" LEFT JOIN rooms r ON ra.room_id=r.id WHERE u.id=?', [user.id])
      : [[{}]];

    const [pendingPayments] = user.role === 'student'
      ? await db.query('SELECT * FROM payments WHERE student_id=? AND status="pending"', [user.id])
      : [[]];

    const [notices] = await db.query('SELECT title, content FROM notices ORDER BY created_at DESC LIMIT 3');

    const system = `তুমি July-6 Hall, PUST (Pabna University of Science and Technology) এর AI Assistant।
তুমি Bangla এবং English দুই ভাষায় কথা বলো। Student যে ভাষায় লিখবে তুমি সেই ভাষায় উত্তর দাও।
Concise ও helpful থাকো।

Current user:
- Name: ${user.name}
- Role: ${user.role}
- Room: ${student.room_number || 'Not assigned'}
- Department: ${student.department || 'N/A'}
- Pending payments: ${pendingPayments.length} টি

Recent notices: ${notices.map(n => n.title).join(', ') || 'None'}

Hall rules:
- Hall fee due: প্রতি মাসের শেষ দিন
- Visitor time: সকাল ৮টা – রাত ৮টা
- Quiet hours: রাত ১০টা – সকাল ৭টা
- Complaints: 24-72 ঘণ্টায় resolve হয়
- WiFi password: Office থেকে নিতে হবে
শুধু hall-related বিষয়ে সাহায্য করো।`;

    const reply = await callClaude(system, message, history.slice(-10));
    res.json({ ok: true, reply });
  } catch (err) {
    res.json({ ok: false, reply: 'AI সাময়িকভাবে unavailable। ANTHROPIC_API_KEY চেক করুন।' });
  }
});

// ── 2. AI NOTICE GENERATOR ─────────────────────────────────────────────────
// POST /ai/generate-notice
// Body: { topic, language }   (admin only)
router.post('/generate-notice', isLoggedIn, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.json({ ok: false, message: 'Admin only' });
  try {
    const { topic, language = 'bangla' } = req.body;
    const system = `তুমি July-6 Hall, PUST এর official notice লেখার expert।
${language === 'bangla' ? 'Notice টি সম্পূর্ণ বাংলায় লিখো।' : 'Write the notice in English.'}
Format: Title → Date → Body → Contact info → Signature (হল প্রভোস্ট)
শুধু notice text দাও, অন্য কিছু বলো না।`;

    const notice = await callClaude(system, `এই topic এ একটি official hall notice লিখো: "${topic}"`);
    const title = notice.split('\n')[0].replace(/[*#]/g, '').trim();
    res.json({ ok: true, notice, title, priority: topic.toLowerCase().includes('জরুরি') || topic.toLowerCase().includes('emergency') ? 'high' : 'normal' });
  } catch (err) {
    res.json({ ok: false, message: 'AI notice generation failed: ' + err.message });
  }
});

// ── 3. AI COMPLAINT AUTO-REPLY ─────────────────────────────────────────────
// POST /ai/complaint-reply
// Body: { complaint_id }   (admin only)
router.post('/complaint-reply', isLoggedIn, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.json({ ok: false, message: 'Admin only' });
  try {
    const db = require('../config/db');
    const [[complaint]] = await db.query('SELECT c.*, u.name AS student_name, u.room_number FROM complaints c JOIN users u ON c.student_id=u.id WHERE c.id=?', [req.body.complaint_id]);
    if (!complaint) return res.json({ ok: false, message: 'Complaint not found' });

    const system = `তুমি July-6 Hall, PUST এর management assistant।
Student complaint এর professional ও empathetic response draft করো।
Banglish (Bangla+English mix) style এ 2-3 sentence এ concise রাখো।
JSON format এ respond করো: {"response": "...", "priority": "high/medium/low", "days": 1-5}`;

    const raw = await callClaude(system,
      `Complaint: Category=${complaint.category}, Subject=${complaint.subject}, Details=${complaint.description}, Student=${complaint.student_name}`
    );

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { response: raw, priority: 'medium', days: 2 };
    } catch { parsed = { response: raw, priority: 'medium', days: 2 }; }

    res.json({ ok: true, ...parsed });
  } catch (err) {
    res.json({ ok: false, message: 'Failed: ' + err.message });
  }
});

// ── 4. AI ROOM RECOMMENDATION ──────────────────────────────────────────────
// POST /ai/recommend-room
// Body: { preferences }
router.post('/recommend-room', isLoggedIn, async (req, res) => {
  try {
    const db = require('../config/db');
    const [rooms] = await db.query(`
      SELECT r.*, 
        (r.capacity - COALESCE(COUNT(ra.id),0)) AS available_spots
      FROM rooms r
      LEFT JOIN room_allocations ra ON r.id=ra.room_id AND ra.status='active'
      GROUP BY r.id
      HAVING available_spots > 0
    `);

    const system = `তুমি July-6 Hall, PUST এর room recommendation system।
Student এর preferences দেখে best room suggest করো।
JSON: {"recommendations": [{"room_number":"...", "score":0-100, "reason":"..."}], "top": "room_number"}`;

    const raw = await callClaude(system,
      `Student preferences: ${req.body.preferences || 'যেকোনো available room'}
Available rooms: ${JSON.stringify(rooms.map(r => ({ number: r.room_number, floor: r.floor, type: r.room_type, spots: r.available_spots })))}`
    );

    const match = raw.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { recommendations: [], top: null };

    // Enrich with full room data
    const enriched = (result.recommendations || []).map(rec => ({
      ...rec,
      room: rooms.find(r => r.room_number === rec.room_number),
    })).filter(r => r.room);

    res.json({ ok: true, recommendations: enriched, top: result.top });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// ── 5. AI DOCUMENT GENERATOR ───────────────────────────────────────────────
// POST /ai/generate-document
// Body: { type, student_id }
router.post('/generate-document', isLoggedIn, async (req, res) => {
  try {
    const db = require('../config/db');
    const targetId = req.body.student_id || req.session.user.id;
    const [[student]] = await db.query(
      'SELECT u.*, r.room_number FROM users u LEFT JOIN room_allocations ra ON u.id=ra.student_id AND ra.status="active" LEFT JOIN rooms r ON ra.room_id=r.id WHERE u.id=?',
      [targetId]
    );
    if (!student) return res.json({ ok: false, message: 'Student not found' });

    const today = new Date().toLocaleDateString('en-GB');
    const prompts = {
      'leaving-certificate': `Generate an official Hall Leaving Certificate for: Name: ${student.name}, Student ID: ${student.student_id}, Room: ${student.room_number}, Hall: July-6 Hall PUST, Date: ${today}. Include: conduct was satisfactory, no dues pending, free to vacate.`,
      'character-certificate': `Generate an official Hall Character Certificate for: Name: ${student.name}, Student ID: ${student.student_id}, Department: ${student.department}, Hall: July-6 Hall PUST, Date: ${today}. Mention good behavior.`,
      'residence-proof': `Generate a Residence Proof / Bonafide Letter for: Name: ${student.name}, Student ID: ${student.student_id}, Room: ${student.room_number}, Hall: July-6 Hall PUST, Date: ${today}.`,
    };

    const system = 'তুমি July-6 Hall, PUST এর official document generator। Formal, professional documents লিখো। Only the document, nothing else.';
    const doc = await callClaude(system, prompts[req.body.type] || `Generate a ${req.body.type} for ${student.name}`);
    res.json({ ok: true, document: doc, student_name: student.name });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

module.exports = router;