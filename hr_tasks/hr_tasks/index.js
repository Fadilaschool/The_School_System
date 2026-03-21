const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./db');
const app = express();
const PORT = process.env.TASK_SERVICE_PORT || 3020;

// Middlewares
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://gc.kis.v2.scr.kaspersky-labs.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://via.placeholder.com", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      connectSrc: [
        "'self'",
        "http://localhost:3020", "ws://localhost:3020",
        "http://localhost:3004", "ws://localhost:3004",
        "https://platform.elfadila.com", "wss://platform.elfadila.com",
        "https://*.elfadila.com", "wss://*.elfadila.com",
        "https://gc.kis.v2.scr.kaspersky-labs.com", "wss://gc.kis.v2.scr.kaspersky-labs.com"
      ]
    },
  })
);

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// JWT verification middleware (optional - only verifies if token is provided)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    // If no token, continue but req.user will be undefined
    req.user = null;
    return next();
  }

  try {
    // Use the same JWT_SECRET as auth-service
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.warn('[Backend] JWT_SECRET not set in environment, token verification may fail');
    }
    const decoded = jwt.verify(token, jwtSecret || 'fallback-secret-key-change-in-production');
    req.user = decoded;
    console.log('[Backend] Token verified, user:', { userId: decoded.userId || decoded.id, role: decoded.role });
    next();
  } catch (error) {
    // If token is invalid, continue without user (for backward compatibility)
    console.warn('[Backend] Invalid token:', error.message);
    req.user = null;
    next();
  }
};

// IMPORTANT: API routes must be mounted BEFORE static files
// Importer tes routes
const reportDataRoutes = require('./reports');   // 📊 data + stats
const reportGenRoutes = require('./generer');    // 📝 ajout + PDF
const rapportempRoutes = require('./rapportemp'); // 📝 interface rapports employé
const instructionsRoutes = require('./instructions'); // 📘 instructions (nouvelle API)
const { router: signalsRouter, complaintsRouter, suggestionsRouter, directorRouter, ensureSignalsSchema } = require('./signals.routes'); // 🔧 signals, complaints & suggestions

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);

const titleCase = (value) => {
  if (!value) return '';
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

// Monter les routes
app.use('/api/reports', reportDataRoutes);  // => /api/reports/data , /api/reports/employee-stats
app.use('/api/reports', reportGenRoutes);   // => /api/reports (POST), /api/reports/:id/pdf
console.log('[SERVER] Mounting rapportemp routes at /api/rapportemp');
console.log('[SERVER] Router type:', typeof rapportempRoutes);
if (rapportempRoutes.stack) {
  console.log('[SERVER] Number of routes registered:', rapportempRoutes.stack.length);
  console.log('[SERVER] First few routes:', rapportempRoutes.stack.slice(0, 5).map(r => r.route?.path || r.regexp?.toString().slice(0, 50)));
}
app.use('/api/rapportemp', (req, res, next) => {
  console.log(`[SERVER] Request to /api/rapportemp${req.path} - forwarding to router`);
  next();
}, rapportempRoutes); // => /api/rapportemp/employee/:id/reports
app.use('/api/instructions', instructionsRoutes); // => /api/instructions
app.use('/api/signals', signalsRouter); // => /api/signals/* (main signals routes)
app.use('/api/complaints', complaintsRouter); // => /api/complaints/* (complaints routes)
app.use('/api/suggestions', suggestionsRouter); // => /api/suggestions/* (suggestions routes)
app.use('/api/director', directorRouter); // => /api/director/* (director-specific routes)

// Servir les fichiers statiques (frontend) - AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));

// Route pour tester le backend
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Task Service', timestamp: new Date().toISOString() });
});

// Route to verify rapportemp router is mounted
app.get('/api/rapportemp/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Rapportemp router is accessible',
    routesCount: rapportempRoutes.stack ? rapportempRoutes.stack.length : 'unknown',
    timestamp: new Date().toISOString()
  });
});

// =====================
// Departments Endpoints
// =====================
app.get('/departments', async (req, res) => {
  try {
    console.log('🔍 ========== DEPARTMENTS ENDPOINT CALLED ==========');
    console.log('📡 Request from:', req.headers['user-agent'] || 'unknown');
    console.log('🌐 Database config:', {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });

    // First, let's check the total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM departments');
    const totalCount = parseInt(countResult.rows[0].total);
    console.log(`🔢 Total departments in database: ${totalCount}`);

    // Get ALL departments - no filtering at all - with detailed info
    const result = await pool.query(`
      SELECT 
        id, 
        name, 
        responsible_id,
        created_at,
        updated_at
      FROM departments
      ORDER BY COALESCE(name, '') ASC, id
    `);

    console.log(`📊 Query returned ${result.rows.length} departments (expected: ${totalCount})`);

    if (result.rows.length !== totalCount) {
      console.error(`❌ MISMATCH: Query returned ${result.rows.length} but COUNT says ${totalCount}!`);
    }

    // Log each department in detail
    console.log('📋 All departments found:');
    result.rows.forEach((d, index) => {
      console.log(`  ${index + 1}. ID: ${d.id}`);
      console.log(`     Name: "${d.name}"`);
      console.log(`     Responsible ID: ${d.responsible_id || 'NULL'}`);
      console.log(`     Created: ${d.created_at || 'NULL'}`);
    });

    // Also check for departments with NULL or empty names
    const nullNameResult = await pool.query(`
      SELECT id, name, responsible_id 
      FROM departments 
      WHERE name IS NULL OR name = ''
    `);
    if (nullNameResult.rows.length > 0) {
      console.warn(`⚠️ Found ${nullNameResult.rows.length} departments with NULL/empty names:`,
        nullNameResult.rows.map(d => ({ id: d.id, name: d.name, responsible_id: d.responsible_id }))
      );
    }

    // Check for specific department names the user mentioned
    const expectedNames = ['depa', 'Direction', 'new teck', 'Ressources Humaines', 'teachers', 'Informatique'];
    const foundNames = result.rows.map(d => d.name);
    console.log('🔍 Checking for expected department names:');
    expectedNames.forEach(name => {
      const found = foundNames.includes(name);
      console.log(`  "${name}": ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);
    });

    console.log('✅ ========== END DEPARTMENTS ENDPOINT ==========');

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur liste départements:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Impossible de récupérer les départements', details: error.message });
  }
});

// Alias avec préfixe /api pour compatibilité frontend
app.get('/api/departments', async (req, res) => {
  try {
    // Check total count first
    const countResult = await pool.query('SELECT COUNT(*) as total FROM departments');
    const totalCount = parseInt(countResult.rows[0].total);

    // Get ALL departments - no filtering
    const result = await pool.query(`
      SELECT id, name, responsible_id
      FROM departments
      ORDER BY COALESCE(name, '') ASC, id
    `);

    console.log(`📊 /api/departments endpoint: Found ${result.rows.length} departments (total in DB: ${totalCount})`);
    console.log('📋 All departments:', result.rows.map(d => ({
      id: d.id,
      name: d.name || '(NULL)',
      responsible_id: d.responsible_id,
      hasName: !!d.name
    })));

    if (result.rows.length !== totalCount) {
      console.warn(`⚠️ Mismatch: Query returned ${result.rows.length} but database has ${totalCount} departments!`);
    }

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur liste départements (/api):', error);
    res.status(500).json({ error: 'Impossible de récupérer les départements', details: error.message });
  }
});

// Diagnostic endpoint to check all departments
app.get('/api/departments/diagnostic', async (req, res) => {
  try {
    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM departments');
    const totalCount = parseInt(countResult.rows[0].total);

    // Get all departments with all fields
    const allDepts = await pool.query(`
      SELECT id, name, responsible_id, created_at
      FROM departments
      ORDER BY name
    `);

    // Get departments with NULL names
    const nullNames = await pool.query(`
      SELECT id, name, responsible_id
      FROM departments 
      WHERE name IS NULL OR name = ''
    `);

    // Expected departments based on user's list
    const expectedDepts = [
      { name: 'depa', responsible: 'Sophie Leroy' },
      { name: 'Direction', responsible: 'Ori Jacobs' },
      { name: 'new teck', responsible: 'Achouak Benmeziane' },
      { name: 'Ressources Humaines', responsible: 'Marie Martin' },
      { name: 'teachers', responsible: 'asma benmoussa' }
    ];

    // Check which expected departments exist
    const existingNames = allDepts.rows.map(d => d.name);
    const missingDepts = expectedDepts.filter(exp => !existingNames.includes(exp.name));

    console.log('🔍 DIAGNOSTIC DEPARTMENTS:');
    console.log(`  Total in database: ${totalCount}`);
    console.log(`  Returned by query: ${allDepts.rows.length}`);
    console.log(`  With NULL/empty names: ${nullNames.rows.length}`);
    console.log(`  Missing expected departments: ${missingDepts.length}`);
    console.log('  Missing:', missingDepts.map(d => d.name));

    res.json({
      total_in_database: totalCount,
      returned_by_query: allDepts.rows.length,
      with_null_names: nullNames.rows.length,
      departments: allDepts.rows,
      null_name_departments: nullNames.rows,
      expected_departments: expectedDepts,
      missing_departments: missingDepts,
      database_info: {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT
      }
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic départements:', error);
    res.status(500).json({ error: 'Impossible de diagnostiquer les départements', details: error.message });
  }
});

// Helper endpoint to add missing departments (for debugging/fixing)
app.post('/api/departments/add-missing', async (req, res) => {
  try {
    const { departments } = req.body;

    if (!Array.isArray(departments)) {
      return res.status(400).json({ error: 'departments must be an array' });
    }

    const results = [];
    const errors = [];

    for (const dept of departments) {
      try {
        // Check if department already exists
        const existing = await pool.query('SELECT id FROM departments WHERE name = $1', [dept.name]);

        if (existing.rows.length > 0) {
          results.push({ name: dept.name, status: 'already_exists', id: existing.rows[0].id });
          continue;
        }

        // Find responsible by name if provided
        let responsibleId = dept.responsible_id || null;
        if (dept.responsible_name && !responsibleId) {
          const nameParts = dept.responsible_name.split(' ');
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(' ');
          const empResult = await pool.query(
            'SELECT id FROM employees WHERE first_name = $1 AND last_name = $2 LIMIT 1',
            [firstName, lastName]
          );
          if (empResult.rows.length > 0) {
            responsibleId = empResult.rows[0].id;
          }
        }

        // Insert department
        const insertResult = await pool.query(
          'INSERT INTO departments (name, responsible_id) VALUES ($1, $2) RETURNING *',
          [dept.name, responsibleId]
        );

        results.push({ name: dept.name, status: 'created', id: insertResult.rows[0].id });
      } catch (error) {
        errors.push({ name: dept.name, error: error.message });
      }
    }

    res.json({
      success: true,
      created: results.filter(r => r.status === 'created').length,
      already_exists: results.filter(r => r.status === 'already_exists').length,
      errors: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Erreur ajout départements:', error);
    res.status(500).json({ error: 'Impossible d\'ajouter les départements', details: error.message });
  }
});

app.get('/departments/:id/employees', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.phone, e.email, e.profile_picture_url, e.nationality, e.join_date, e.address
      FROM employees e
      INNER JOIN employee_departments ed ON ed.employee_id = e.id
      WHERE ed.department_id = $1
      ORDER BY e.first_name, e.last_name
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur employés par département:', error);
    res.status(500).json({ error: 'Impossible de récupérer les employés du département' });
  }
});

// Alias avec préfixe /api pour compatibilité frontend
app.get('/api/departments/:id/employees', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.phone, e.email, e.profile_picture_url, e.nationality, e.join_date, e.address
      FROM employees e
      INNER JOIN employee_departments ed ON ed.employee_id = e.id
      WHERE ed.department_id = $1
      ORDER BY e.first_name, e.last_name
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur employés par département (/api):', error);
    res.status(500).json({ error: 'Impossible de récupérer les employés du département' });
  }
});

// Route principale pour le frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
});

// Démarrer serveur HTTP + Socket.IO
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
  try {
    // Le client envoie son userId pour rejoindre sa "room" dédiée
    socket.on('register', (userId) => {
      if (!userId) return;
      const room = `user:${userId}`;
      socket.join(room);
      try { console.log('[WS] socket registered to room', room); } catch (_) { }
    });

    // Gérer la demande de liste des notifications
    socket.on('notifications:list', async (data) => {
      try {
        const { user_id } = data;
        if (!user_id) return;

        console.log('[WS] Client requesting notifications for user:', user_id);

        // Récupérer les notifications non supprimées depuis la base de données
        const result = await pool.query(
          `SELECT id, user_id, title, body, type, ref_type, ref_id, created_at, is_read
           FROM notifications
           WHERE user_id = $1
           ORDER BY is_read ASC, created_at DESC
           LIMIT 50`,
          [user_id]
        );

        const notifications = result.rows || [];
        console.log('[WS] Sending', notifications.length, 'notifications to user:', user_id);

        // Envoyer la liste des notifications au client
        socket.emit('notifications:list', notifications);
      } catch (e) {
        console.error('[WS] Error handling notifications:list:', e);
        socket.emit('notifications:list', []);
      }
    });

  } catch (_) { /* noop */ }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Task Service running on port ${PORT}`);
  await ensureNotificationsTable();
});

// =====================
// Notifications support
// =====================
async function ensureNotificationsTable() {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE TABLE IF NOT EXISTS public.notifications
      (
          id uuid NOT NULL DEFAULT uuid_generate_v4(),
          recipient_id uuid,
          sender_id uuid,
          type character varying(100) NOT NULL,
          message text,
          is_read boolean NOT NULL DEFAULT false,
          created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          user_id uuid NOT NULL,
          title text NOT NULL,
          body text,
          ref_type text,
          ref_id uuid,
          CONSTRAINT notifications_pkey PRIMARY KEY (id)
      );
      DO $$ BEGIN
        BEGIN
          ALTER TABLE public.notifications
            ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id)
            REFERENCES public.employees (id) ON UPDATE NO ACTION ON DELETE NO ACTION;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN
          ALTER TABLE public.notifications
            ADD CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id)
            REFERENCES public.employees (id) ON UPDATE NO ACTION ON DELETE NO ACTION;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id
          ON public.notifications USING btree (recipient_id ASC NULLS LAST);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
          ON public.notifications USING btree (user_id ASC NULLS LAST, created_at DESC NULLS FIRST);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_read
          ON public.notifications USING btree (user_id ASC NULLS LAST, is_read ASC NULLS LAST);
    `);
    console.log('Notifications table ensured');
  } catch (e) { console.warn('ensureNotificationsTable error', e.message); }
}

const { v4: uuidv4 } = require('uuid');

// Cache pour éviter les notifications en double
const notificationCache = new Map();
const CACHE_DURATION = 5000; // 5 secondes

async function createNotification({ userId, title, body, type, refType, refId, senderId }) {
  try {
    // Validation des paramètres
    if (!userId) {
      console.warn('createNotification: userId is required');
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.warn('createNotification: userId must be a valid UUID');
      return;
    }

    // Créer une clé de déduplication plus spécifique
    const dedupKey = `${userId}-${type}-${refType}-${refId}-${title}-${body}`;
    const now = Date.now();

    // Vérifier si une notification similaire a été envoyée récemment
    if (notificationCache.has(dedupKey)) {
      const lastSent = notificationCache.get(dedupKey);
      if (now - lastSent < CACHE_DURATION) {
        console.log('Notification duplicate prevented:', dedupKey);
        return;
      }
    }

    // Mettre à jour le cache
    notificationCache.set(dedupKey, now);

    // Nettoyer le cache plus agressivement
    if (notificationCache.size > 500) {
      const cutoff = now - CACHE_DURATION;
      for (const [key, timestamp] of notificationCache.entries()) {
        if (timestamp < cutoff) {
          notificationCache.delete(key);
        }
      }
    }


    // Vérifier s'il existe déjà une notification similaire dans les 30 dernières secondes
    const recentCheck = await pool.query(`
      SELECT id FROM notifications 
      WHERE user_id = $1 
      AND type = $2 
      AND ref_type = $3 
      AND ref_id = $4 
      AND title = $5 
      AND created_at > NOW() - INTERVAL '30 seconds'
      LIMIT 1
    `, [userId, type || null, refType || null, refId || null, title || '']);

    if (recentCheck.rows.length > 0) {
      console.log('Notification duplicate prevented in database:', recentCheck.rows[0].id);
      return;
    }

    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO notifications(id, user_id, recipient_id, sender_id, title, body, type, ref_type, ref_id)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id as userId, recipient_id as recipientId, sender_id as senderId, title, body, type, ref_type as refType, ref_id as refId, created_at, is_read`,
      [id, userId, userId, senderId || null, title || '', body || null, type || null, refType || null, refId || null]
    );

    console.log('Notification created for user:', userId, 'type:', type);

    // Emettre en temps réel vers l'utilisateur ciblé
    try {
      const room = `user:${userId}`;
      const size = (io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms && io.sockets.adapter.rooms.get) ? (io.sockets.adapter.rooms.get(room)?.size || 0) : 0;
      console.log('[WS] emit notification to', room, 'subscribers:', size);
      io.to(room).emit('notification:new', result.rows[0]);
    } catch (_) { /* noop */ }

  } catch (e) {
    console.warn('createNotification error:', e.message);
  }
}

// Expose notifications API
// Remplacez votre endpoint /notifications par celui-ci :
app.get('/notifications', async (req, res) => {
  try {
    // Ensure table exists even if server boot order changed
    await ensureNotificationsTable();

    const { user_id, since, unread_only } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Validation UUID simple
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user_id)) {
      return res.status(400).json({ error: 'user_id must be a valid UUID' });
    }

    const params = [user_id];
    let where = 'user_id = $1';

    if (since) {
      let iso = null;
      try {
        const d = new Date(since);
        if (!isNaN(d.getTime())) {
          iso = d.toISOString();
        }
      } catch (_) { }

      if (iso) {
        params.push(iso);
        where += ` AND created_at >= $${params.length}`;
      }
    }

    if (String(unread_only) === 'true') {
      where += ' AND is_read = false';
    }

    console.log('Notifications query:', { user_id, where, params });

    const result = await pool.query(
      `SELECT id, user_id, title, body, type, ref_type, ref_id, created_at, is_read
       FROM notifications
       WHERE ${where}
       ORDER BY is_read ASC, created_at DESC
       LIMIT 100`,
      params
    );

    console.log('Notifications result:', result.rows.length, 'notifications found');

    res.json({
      success: true,
      notifications: result.rows
    });

  } catch (e) {
    console.error('GET /notifications error:', e);
    res.status(500).json({
      error: 'Failed to fetch notifications',
      details: process.env.NODE_ENV === 'development' ? e.message : undefined
    });
  }
});

// Fonction createNotification déjà définie plus haut avec déduplication

// Améliorez la fonction ensureNotificationsTable :
async function ensureNotificationsTable() {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY
      );
      -- Ajouter/normaliser les colonnes manquantes
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_type TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id UUID;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN;
      -- Définir des valeurs par défaut si null
      UPDATE notifications SET created_at = NOW() WHERE created_at IS NULL;
      UPDATE notifications SET is_read = FALSE WHERE is_read IS NULL;
      -- Contraintes NOT NULL là où pertinent
      ALTER TABLE notifications ALTER COLUMN title SET NOT NULL;
      ALTER TABLE notifications ALTER COLUMN user_id SET NOT NULL;
      ALTER TABLE notifications ALTER COLUMN created_at SET NOT NULL;
      ALTER TABLE notifications ALTER COLUMN is_read SET NOT NULL;
      -- S'assurer que la colonne message n'est pas NOT NULL si elle existait
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='notifications' AND column_name='message'
        ) THEN
          BEGIN
            ALTER TABLE notifications ALTER COLUMN message DROP NOT NULL;
          EXCEPTION WHEN others THEN
            -- ignore
            NULL;
          END;
        END IF;
      END $$;
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
        ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_read 
        ON notifications(user_id, is_read);
    `);
    console.log('Notifications table ensured');
  } catch (e) { console.error('ensureNotificationsTable error', e); throw e; }
}

app.put('/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(`UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true, notification: r.rows[0] });
  } catch (e) { console.error('PUT /notifications/:id/read', e); res.status(500).json({ error: 'Failed to mark as read' }); }
});

// Route pour obtenir les détails d'une notification et marquer comme lue
app.get('/notifications/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Récupérer la notification et vérifier qu'elle appartient à l'utilisateur
    const r = await pool.query(`
      SELECT * FROM notifications 
      WHERE id = $1 AND user_id = $2
    `, [id, user_id]);

    if (!r.rows.length) {
      return res.status(404).json({ error: 'Notification not found or unauthorized' });
    }

    const notification = r.rows[0];

    // Marquer comme lue si ce n'est pas déjà fait
    if (!notification.is_read) {
      await pool.query(`UPDATE notifications SET is_read = true WHERE id = $1`, [id]);
      notification.is_read = true;
    }

    res.json({
      success: true,
      notification: notification,
      // Ajouter des détails supplémentaires selon le type
      details: await getNotificationDetails(notification)
    });
  } catch (e) {
    console.error('GET /notifications/:id/details', e);
    res.status(500).json({ error: 'Failed to get notification details' });
  }
});

// Fonction helper pour obtenir les détails d'une notification
async function getNotificationDetails(notification) {
  try {
    const { type, ref_type, ref_id } = notification;

    if (ref_type === 'task' && ref_id) {
      const taskRes = await pool.query(`
        SELECT t.*, 
               assigned_by_emp.first_name as assigned_by_first_name,
               assigned_by_emp.last_name as assigned_by_last_name
        FROM tasks t
        LEFT JOIN employees assigned_by_emp ON t.assigned_by = assigned_by_emp.id
        WHERE t.id = $1
      `, [ref_id]);

      if (taskRes.rows.length > 0) {
        return {
          type: 'task',
          task: taskRes.rows[0]
        };
      }
    }

    return null;
  } catch (e) {
    console.warn('Error getting notification details:', e.message);
    return null;
  }
}

app.put('/notifications/mark-all-read', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const r = await pool.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false RETURNING id`, [user_id]);
    res.json({ success: true, updated: r.rows.length });
  } catch (e) { console.error('PUT /notifications/mark-all-read', e); res.status(500).json({ error: 'Failed to mark all read' }); }
});

// Supprimer une notification
app.delete('/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Deleting notification:', id);

    // Vérifier d'abord si la notification existe
    const checkResult = await pool.query(`SELECT id, user_id FROM notifications WHERE id = $1`, [id]);
    if (checkResult.rows.length === 0) {
      console.log('Notification not found:', id);
      return res.status(404).json({ error: 'Notification not found' });
    }

    console.log('Found notification:', checkResult.rows[0]);

    // Supprimer la notification
    const r = await pool.query(`DELETE FROM notifications WHERE id = $1 RETURNING id`, [id]);
    console.log('Deleted notification:', r.rows[0]);

    res.json({ success: true, deleted: r.rows[0].id });
  } catch (e) {
    console.error('DELETE /notifications/:id error:', e);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Supprimer toutes les notifications d'un utilisateur
app.delete('/notifications', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    console.log('Clearing all notifications for user:', user_id);

    // Vérifier d'abord combien de notifications existent
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM notifications WHERE user_id = $1`, [user_id]);
    const count = parseInt(countResult.rows[0].count);
    console.log('Found', count, 'notifications to delete');

    // Supprimer toutes les notifications
    const r = await pool.query(`DELETE FROM notifications WHERE user_id = $1 RETURNING id`, [user_id]);
    console.log('Deleted', r.rows.length, 'notifications');

    res.json({ success: true, deleted: r.rows.map(x => x.id), count: r.rows.length });
  } catch (e) {
    console.error('DELETE /notifications error:', e);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Get all employees
app.get('/employees', async (req, res) => {
  try {
    const { responsible_id } = req.query;

    if (responsible_id && responsible_id !== 'null' && responsible_id !== 'undefined') {
      console.log('[EMPLOYEES] Filter by responsible_id =', responsible_id);
      // Filtrer les employés par département dont "responsible_id" est le responsable
      const result = await pool.query(`
        SELECT DISTINCT 
          e.id, 
          e.first_name, 
          e.last_name,
          d.id as department_id,
          d.name as department_name
        FROM employees e
        INNER JOIN employee_departments ed ON ed.employee_id = e.id
        INNER JOIN departments d ON d.id = ed.department_id
        WHERE d.responsible_id = $1
        ORDER BY e.first_name, e.last_name
      `, [responsible_id]);
      console.log('[EMPLOYEES] Found', result.rows.length, 'employees for responsible');
      // Add department field for compatibility
      result.rows.forEach(row => {
        row.department = row.department_name;
      });
      return res.json(result.rows);
    }

    // Sinon: renvoyer tous les employés avec leurs départements
    const result = await pool.query(`
      SELECT 
        e.id, 
        e.first_name, 
        e.last_name,
        d.id as department_id,
        d.name as department_name
      FROM employees e
      LEFT JOIN employee_departments ed ON e.id = ed.employee_id
      LEFT JOIN departments d ON ed.department_id = d.id
      ORDER BY e.first_name, e.last_name
    `);
    // Group by employee and combine departments (in case an employee has multiple departments)
    const employeeMap = new Map();
    result.rows.forEach(row => {
      if (!employeeMap.has(row.id)) {
        employeeMap.set(row.id, {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          department: row.department_name || null,
          department_id: row.department_id || null
        });
      } else {
        // If employee has multiple departments, combine them
        const emp = employeeMap.get(row.id);
        if (row.department_name && emp.department !== row.department_name) {
          emp.department = emp.department ? `${emp.department}, ${row.department_name}` : row.department_name;
        }
      }
    });
    return res.json(Array.from(employeeMap.values()));
  } catch (error) {
    console.error('Erreur récupération employés:', error);
    res.status(500).json({ error: 'Impossible de récupérer les employés' });
  }
});

// Récupérer un employé par son user_id (fallback pour frontend)
app.get('/employees/by-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.user_id,
        d.id as department_id,
        d.name as department_name
      FROM employees e
      LEFT JOIN employee_departments ed ON e.id = ed.employee_id
      LEFT JOIN departments d ON ed.department_id = d.id
      WHERE e.user_id = $1
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found for given user_id' });
    }
    res.json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Erreur récupération employé par user_id:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Retourner les départements d'un responsable (par nom)
app.get('/responsibles/:id/departments', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'null' || id === 'undefined') {
      return res.json({ departments: [] });
    }
    const result = await pool.query(`
      SELECT d.id, d.name
      FROM departments d
      WHERE d.responsible_id = $1
      ORDER BY d.name
    `, [id]);
    res.json({ departments: result.rows });
  } catch (error) {
    console.error('Erreur récupération départements responsable:', error);
    res.status(500).json({ error: 'Impossible de récupérer les départements' });
  }
});

// Get all responsible users with their usernames
app.get('/responsibles', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.email,
        e.phone,
        u.username,
        u.role,
        d.name as department_name,
        d.id as department_id
      FROM employees e
      INNER JOIN departments d ON d.responsible_id = e.id
      LEFT JOIN users u ON u.id = e.user_id
      ORDER BY d.name, e.first_name, e.last_name
    `);

    res.json({
      success: true,
      responsibles: result.rows
    });
  } catch (error) {
    console.error('Erreur récupération responsables:', error);
    res.status(500).json({
      error: 'Impossible de récupérer les responsables',
      details: error.message
    });
  }
});
app.get('/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('GET /employees/:id ID:', id);

    // Include department information in the query
    const result = await pool.query(
      `SELECT 
        e.id, 
        e.first_name, 
        e.last_name, 
        e.phone,
        d.id as department_id,
        d.name as department_name
      FROM employees e
      LEFT JOIN employee_departments ed ON e.id = ed.employee_id
      LEFT JOIN departments d ON ed.department_id = d.id
      WHERE e.id = $1
      LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Employee not found: ${id}`);
      return res.status(404).json({
        error: 'Employee not found',
        details: `Aucun employé trouvé avec l'ID: ${id}`
      });
    }

    const employee = result.rows[0];
    // If multiple departments, get the first one (or you could return an array)
    console.log(`✅ Employee found: ${employee.first_name} ${employee.last_name}, Department: ${employee.department_name || 'None'}`);
    res.json(employee);
  } catch (error) {
    console.error('GET /employees/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/tasks', verifyToken, async (req, res) => {
  try {
    const { status, type, priority, assigned_to, employee_id } = req.query;

    let query = `
      SELECT 
        t.id,
        t.title,
        t.description,
        t.type,
        t.assigned_by,
        t.due_date,
        t.status,
        t.created_at,
        t.updated_at,
        t.priority,
        assigned_by_emp.first_name as assigned_by_first_name,
        assigned_by_emp.last_name as assigned_by_last_name,
        (SELECT u.role FROM users u WHERE u.id = assigned_by_emp.user_id LIMIT 1) as assigned_by_role,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', ta_sub.employee_id,
              'first_name', e_sub.first_name,
              'last_name', e_sub.last_name,
              'status', ta_sub.status,
              'assigned_at', ta_sub.assigned_at
            )
          )
          FROM task_assignments ta_sub
          LEFT JOIN employees e_sub ON ta_sub.employee_id = e_sub.id
          WHERE ta_sub.task_id = t.id AND ta_sub.employee_id IS NOT NULL),
          '[]'::json
        )::json as assignees
      FROM tasks t
      LEFT JOIN employees assigned_by_emp ON t.assigned_by = assigned_by_emp.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    // Role-based filtering if user is authenticated
    console.log('[Backend] /tasks request - req.user:', req.user ? { userId: req.user.userId || req.user.id, role: req.user.role } : 'null');

    if (req.user && req.user.role) {
      if (req.user.role === 'Employee') {
        // Employees can only see tasks assigned to them
        // First, get the employee_id from the user_id
        const userId = req.user.userId || req.user.id;
        console.log(`[Backend] Employee role detected, looking up employee for user_id: ${userId}`);

        try {
          // Try to find employee by user_id first
          let empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);

          // If not found by user_id, check if userId itself is an employee_id
          if (empResult.rows.length === 0) {
            console.log(`[Backend] No employee found with user_id ${userId}, checking if it's an employee_id...`);
            empResult = await pool.query('SELECT id FROM employees WHERE id = $1', [userId]);
          }

          console.log(`[Backend] Employee lookup result:`, empResult.rows.length > 0 ? { employeeId: empResult.rows[0].id } : 'NOT FOUND');

          if (empResult.rows.length > 0) {
            const employeeId = empResult.rows[0].id;
            // Filter tasks where this employee is in the assignees
            query += ` AND EXISTS (
              SELECT 1 FROM task_assignments ta2 
              WHERE ta2.task_id = t.id 
              AND ta2.employee_id = $${paramCount}
            )`;
            params.push(employeeId);
            paramCount++;
            console.log(`[Backend] ✅ Filtering tasks for Employee role, employee_id: ${employeeId}, added EXISTS clause`);
          } else {
            // No employee record found for this user - return empty
            console.warn(`[Backend] ❌ No employee record found for user_id: ${userId}`);
            return res.json([]);
          }
        } catch (err) {
          console.error('[Backend] ❌ Error looking up employee:', err);
          // Continue without filtering if lookup fails
        }
      } else if (req.user.role === 'Department_Responsible') {
        // Department responsibles can see tasks they assigned or tasks for their department employees
        try {
          const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [req.user.userId || req.user.id]);
          if (empResult.rows.length > 0) {
            const responsibleId = empResult.rows[0].id;
            query += ` AND (
              t.assigned_by = $${paramCount} 
              OR EXISTS (
                SELECT 1 FROM task_assignments ta3
                JOIN employee_departments ed ON ta3.employee_id = ed.employee_id
                JOIN departments d ON ed.department_id = d.id
                WHERE ta3.task_id = t.id
                AND d.responsible_id = $${paramCount}
              )
            )`;
            params.push(responsibleId);
            paramCount++;
          }
        } catch (err) {
          console.error('[Backend] Error looking up department responsible:', err);
        }
      }
      // HR Manager can see all tasks (no additional filtering)
    }

    // Support employee_id query parameter for explicit filtering
    if (employee_id) {
      console.log(`[Backend] employee_id query parameter provided: ${employee_id}`);

      // Sanitize employee_id: remove any invalid suffix like :1, :2, etc.
      let sanitizedEmployeeId = employee_id;
      if (typeof employee_id === 'string' && employee_id.includes(':')) {
        sanitizedEmployeeId = employee_id.split(':')[0];
        console.log(`[Backend] ⚠️ Sanitized employee_id by removing suffix: ${sanitizedEmployeeId}`);
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sanitizedEmployeeId)) {
        console.error(`[Backend] ❌ Invalid employee_id format: ${sanitizedEmployeeId}`);
        return res.status(400).json({
          error: 'Invalid employee_id format',
          details: 'employee_id must be a valid UUID'
        });
      }

      // Resolve employee_id: check if it's a user_id first, then use as employee_id
      let actualEmployeeId = sanitizedEmployeeId;
      try {
        // First, check if it's already an employee_id
        const empCheckResult = await pool.query('SELECT id FROM employees WHERE id = $1 LIMIT 1', [sanitizedEmployeeId]);
        if (empCheckResult.rows.length > 0) {
          // It's already an employee_id, use it as is
          actualEmployeeId = sanitizedEmployeeId;
          console.log(`[Backend] ✅ Using ${sanitizedEmployeeId} as employee_id directly`);
        } else {
          // Check if it's a user_id and resolve to employee_id
          // If we have an authenticated user and the passed ID matches their user_id, 
          // resolve to their specific employee record
          let userEmpResult;
          if (req.user && (req.user.userId || req.user.id)) {
            const authUserId = req.user.userId || req.user.id;
            // If the passed employee_id matches the authenticated user's ID, 
            // first try to get their employee record directly
            if (sanitizedEmployeeId === authUserId) {
              // Try to get employee record for authenticated user
              const authEmpResult = await pool.query('SELECT id, first_name, last_name FROM employees WHERE user_id = $1', [authUserId]);
              if (authEmpResult.rows.length > 0) {
                // If multiple employees have same user_id, try to match by name
                if (authEmpResult.rows.length > 1) {
                  const userFirstName = req.user.firstName || req.user.first_name;
                  const userLastName = req.user.lastName || req.user.last_name;

                  if (userFirstName && userLastName) {
                    // Try to match by name (case-insensitive)
                    const matchedEmp = authEmpResult.rows.find(emp =>
                      emp.first_name?.toLowerCase() === userFirstName.toLowerCase() &&
                      emp.last_name?.toLowerCase() === userLastName.toLowerCase()
                    );
                    if (matchedEmp) {
                      actualEmployeeId = matchedEmp.id;
                      console.log(`[Backend] 🔄 Resolved authenticated user_id ${authUserId} to employee_id ${actualEmployeeId} by name match (${userFirstName} ${userLastName})`);
                    } else {
                      // Use first one if no name match
                      actualEmployeeId = authEmpResult.rows[0].id;
                      console.warn(`[Backend] ⚠️ Multiple employees found with user_id ${authUserId}, no name match for ${userFirstName} ${userLastName}, using first: ${actualEmployeeId}`);
                    }
                  } else {
                    // No name info, use first one
                    actualEmployeeId = authEmpResult.rows[0].id;
                    console.warn(`[Backend] ⚠️ Multiple employees found with user_id ${authUserId}, no name info in token, using first: ${actualEmployeeId}`);
                  }
                } else {
                  // Only one employee or no name info, use it
                  actualEmployeeId = authEmpResult.rows[0].id;
                  console.log(`[Backend] 🔄 Resolved authenticated user_id ${authUserId} to employee_id ${actualEmployeeId}`);
                }
              } else {
                // Fallback: check if it's a user_id for any employee
                userEmpResult = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [sanitizedEmployeeId]);
                if (userEmpResult.rows.length > 0) {
                  actualEmployeeId = userEmpResult.rows[0].id;
                  console.log(`[Backend] 🔄 Resolved user_id ${sanitizedEmployeeId} to employee_id ${actualEmployeeId}`);
                }
              }
            } else {
              // Check if it's a user_id for any employee
              userEmpResult = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [sanitizedEmployeeId]);
              if (userEmpResult.rows.length > 0) {
                actualEmployeeId = userEmpResult.rows[0].id;
                console.log(`[Backend] 🔄 Resolved user_id ${sanitizedEmployeeId} to employee_id ${actualEmployeeId}`);
              }
            }
          } else {
            // No authenticated user, just check if it's a user_id
            userEmpResult = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [sanitizedEmployeeId]);
            if (userEmpResult.rows.length > 0) {
              actualEmployeeId = userEmpResult.rows[0].id;
              console.log(`[Backend] 🔄 Resolved user_id ${sanitizedEmployeeId} to employee_id ${actualEmployeeId}`);
            }
          }

          if (!actualEmployeeId || actualEmployeeId === sanitizedEmployeeId) {
            // If we couldn't resolve it, check if it's invalid
            const finalCheck = await pool.query('SELECT id FROM employees WHERE user_id = $1 OR id = $1 LIMIT 1', [sanitizedEmployeeId]);
            if (finalCheck.rows.length === 0) {
              console.warn(`[Backend] ⚠️ ${sanitizedEmployeeId} is neither a valid user_id nor employee_id`);
              return res.status(404).json({
                error: 'Employee not found',
                details: `No employee found with ID or user_id: ${sanitizedEmployeeId}`
              });
            }
            actualEmployeeId = finalCheck.rows[0].id;
          }
        }
      } catch (resolveErr) {
        console.error('[Backend] ❌ Error resolving employee_id:', resolveErr);
        // Continue with original value if resolution fails
      }

      query += ` AND EXISTS (
        SELECT 1 FROM task_assignments ta4 
        WHERE ta4.task_id = t.id 
        AND ta4.employee_id = $${paramCount}
      )`;
      params.push(actualEmployeeId);
      paramCount++;
      console.log(`[Backend] ✅ Added employee_id filter to query with resolved employee_id: ${actualEmployeeId}`);
    }

    if (status) {
      query += ` AND t.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (type) {
      query += ` AND t.type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }

    if (priority) {
      query += ` AND t.priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    // Handle assigned_to parameter if provided (legacy support, but use task_assignments)
    if (assigned_to) {
      console.log(`[Backend] assigned_to query parameter provided: ${assigned_to}`);
      // Use task_assignments table instead of non-existent assigned_to column
      query += ` AND EXISTS (
        SELECT 1 FROM task_assignments ta5 
        WHERE ta5.task_id = t.id 
        AND ta5.employee_id = $${paramCount}
      )`;
      params.push(assigned_to);
      paramCount++;
      console.log(`[Backend] ✅ Added assigned_to filter to query`);
    }

    query += ` ORDER BY t.created_at DESC`;

    console.log('[Backend] Final query:', query);
    console.log('[Backend] Final query params:', params);
    console.log('[Backend] Executing query with', params.length, 'parameters');
    console.log('[Backend] Full query:', query.replace(/\s+/g, ' ').trim());

    let result;
    try {
      result = await pool.query(query, params);
      console.log(`[Backend] Query returned ${result.rows.length} tasks`);
    } catch (queryError) {
      console.error('[Backend] ❌ Main query error:', queryError);
      console.error('[Backend] Query that failed:', query);
      console.error('[Backend] Params that failed:', params);
      throw queryError;
    }

    // Transformer les résultats pour regrouper les assignés
    const tasks = result.rows.map(row => {
      const assignees = (row.assignees || []).filter(a => a && a.id !== null);
      const task = { ...row, assignees };

      // Log first task for debugging Employee role
      if (req.user && req.user.role === 'Employee' && result.rows.indexOf(row) === 0) {
        console.log('[Backend] First task sample for Employee:', {
          taskId: task.id,
          taskTitle: task.title,
          assignees: assignees.map(a => ({ id: a.id, name: `${a.first_name} ${a.last_name}` }))
        });
      }

      // Debug: Log director tasks
      if (task.assigned_by_role === 'Director' || (!task.assigned_by_first_name && !task.assigned_by_last_name)) {
        console.log('🏢 [Backend] Task with director role:', {
          taskId: task.id,
          title: task.title,
          assigned_by_role: task.assigned_by_role,
          assigned_by: task.assigned_by,
          assigned_by_first_name: task.assigned_by_first_name,
          assigned_by_last_name: task.assigned_by_last_name
        });
      }

      return task;
    });

    // Récupérer commentaires et rapports pour toutes les tâches en une fois
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length > 0) {
      // Comments
      const commentsQuery = `
        SELECT 
          tc.task_id,
          tc.id,
          tc.comment AS text,
          tc.created_at,
          e.first_name || ' ' || e.last_name AS author_name,
          e.id AS employee_id
        FROM task_comments tc
        JOIN employees e ON e.id = tc.employee_id
        WHERE tc.task_id = ANY($1::uuid[])
        ORDER BY tc.created_at DESC
      `;
      let commentsRes;
      try {
        commentsRes = await pool.query(commentsQuery, [taskIds]);
      } catch (err) {
        console.error('[Backend] Error fetching comments:', err);
        commentsRes = { rows: [] };
      }
      const taskIdToComments = new Map();
      (commentsRes.rows || []).forEach(c => {
        const key = String(c.task_id);
        if (!taskIdToComments.has(key)) taskIdToComments.set(key, []);
        taskIdToComments.get(key).push({
          id: c.id,
          text: c.text,
          created_at: c.created_at,
          author_name: c.author_name,
          employee_id: c.employee_id
        });
      });

      // Reports
      const reportsQuery = `
        SELECT 
          r.task_id,
          r.id,
          r.description AS content,
          r.remarks,
          r.created_at,
          r.pdf_url,
          e.first_name || ' ' || e.last_name AS author_name,
          e.id AS employee_id
        FROM reports r
        JOIN employees e ON e.id = r.employee_id
        WHERE r.task_id = ANY($1::uuid[])
        ORDER BY r.created_at DESC
      `;
      let reportsRes;
      try {
        reportsRes = await pool.query(reportsQuery, [taskIds]);
      } catch (err) {
        console.error('[Backend] Error fetching reports:', err);
        reportsRes = { rows: [] };
      }
      const taskIdToReports = new Map();
      (reportsRes.rows || []).forEach(r => {
        const key = String(r.task_id);
        if (!taskIdToReports.has(key)) taskIdToReports.set(key, []);
        taskIdToReports.get(key).push({
          id: r.id,
          content: r.content,
          remarks: r.remarks,
          created_at: r.created_at,
          pdf_url: r.pdf_url,
          author_name: r.author_name,
          employee_id: r.employee_id
        });
      });

      // Attacher aux tâches
      tasks.forEach(t => {
        const key = String(t.id);
        t.comments = taskIdToComments.get(key) || [];
        t.reports = taskIdToReports.get(key) || [];
      });
    }

    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      stack: error.stack
    });
    console.error('Query that failed:', query);
    console.error('Params that failed:', params);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      hint: error.hint || undefined
    });
  }
});

// Create new task with multiple assignees
app.post('/tasks', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { title, description, type, assigned_to, due_date, priority, assigned_by } = req.body;

    console.log('=== BACKEND DEBUGGING ===');
    console.log('Received assigned_by:', assigned_by);
    console.log('Full request body:', req.body);

    // Normalize assigned_to to an array (accept single UUID or array)
    const assignees = Array.isArray(assigned_to) ? assigned_to.filter(Boolean) : [assigned_to].filter(Boolean);

    if (!title || !type || assignees.length === 0) {
      return res.status(400).json({
        error: 'Champs requis manquants: title, type, et au moins un employé assigné'
      });
    }

    // ❌ SUPPRIMER CETTE PARTIE QUI CAUSE LE PROBLÈME :
    /*
    const assignedByResult = await client.query(
      'SELECT id FROM employees ORDER BY created_at ASC LIMIT 1'
    );
    const assigned_by = assignedByResult.rows[0].id;
    */

    // ✅ NOUVELLE LOGIQUE : Utiliser seulement assigned_by du frontend
    if (!assigned_by) {
      return res.status(400).json({
        error: 'assigned_by is required. Cannot identify current user.',
        received_data: { assigned_by, title, type }
      });
    }

    // Debug: Check what database we're connected to
    const dbInfo = await client.query('SELECT current_database() as db, current_schema() as schema');
    console.log('🔍 Connected to database:', dbInfo.rows[0]);

    // Debug: Check if user exists at all
    const userTest = await client.query('SELECT id, username, role FROM users WHERE id = $1', [assigned_by]);
    console.log('🔍 Direct user query result:', userTest.rows.length, userTest.rows[0] || 'NONE');
    const userRecord = userTest.rows[0] || null;

    // Vérifier que l'assigned_by existe dans la base
    // D'abord, essayer comme employee ID
    let assignedByCheck = await client.query(
      'SELECT id, first_name, last_name FROM employees WHERE id = $1',
      [assigned_by]
    );
    console.log('🔍 Check 1 - As employee ID:', assignedByCheck.rows.length, 'results');
    let assignedByEmployee = assignedByCheck.rows[0] || null;

    // Si pas trouvé comme employee ID, essayer comme user_id dans employees
    if (!assignedByEmployee) {
      // First, verify the user exists
      const userVerify = await client.query('SELECT id, username, role FROM users WHERE id = $1', [assigned_by]);
      console.log('🔍 User verification:', userVerify.rows.length, userVerify.rows[0] || 'NOT FOUND');

      assignedByCheck = await client.query(
        'SELECT id, first_name, last_name, user_id FROM employees WHERE user_id = $1',
        [assigned_by]
      );
      console.log('🔍 Check 2 - As user_id in employees:', assignedByCheck.rows.length, 'results');
      if (assignedByCheck.rows.length > 0) {
        assignedByEmployee = assignedByCheck.rows[0];
        console.log('✅ Found employee:', assignedByEmployee);
      } else {
        // If not found, try to find any employee that might be linked
        const allEmployees = await client.query('SELECT id, first_name, last_name, user_id FROM employees LIMIT 5');
        console.log('🔍 Sample employees in DB:', allEmployees.rows.map(e => ({ id: e.id, user_id: e.user_id })));
      }
    }

    // Si toujours pas trouvé, vérifier si c'est un user_id et trouver l'employee
    // (pour les Department Responsibles et autres utilisateurs)
    if (!assignedByEmployee) {
      // Vérifier si c'est un user_id dans la table users
      const userCheck = await client.query(
        'SELECT id, role FROM users WHERE id = $1',
        [assigned_by]
      );

      if (userCheck.rows.length > 0) {
        const user = userCheck.rows[0];
        // Si c'est un Department_Responsible, chercher l'employee via departments.responsible_id
        // (car le responsible_id pointe vers employees.id)
        if (user.role === 'Department_Responsible') {
          // Chercher l'employee qui est responsable d'un département
          // et qui a ce user_id OU qui est référencé comme responsible_id
          assignedByCheck = await client.query(`
            SELECT DISTINCT e.id, e.first_name, e.last_name
            FROM employees e
            INNER JOIN departments d ON d.responsible_id = e.id
            LEFT JOIN users u ON u.id = e.user_id
            WHERE (e.user_id = $1 OR u.id = $1)
            LIMIT 1
          `, [assigned_by]);

          // Si toujours pas trouvé, essayer de trouver n'importe quel employee avec ce user_id
          if (assignedByCheck.rows.length === 0) {
            assignedByCheck = await client.query(
              'SELECT id, first_name, last_name FROM employees WHERE user_id = $1 LIMIT 1',
              [assigned_by]
            );
          }
        } else {
          // Pour les autres rôles, essayer de trouver l'employee par user_id
          assignedByCheck = await client.query(
            'SELECT id, first_name, last_name FROM employees WHERE user_id = $1 LIMIT 1',
            [assigned_by]
          );
        }
      }
      if (assignedByCheck.rows.length > 0) {
        assignedByEmployee = assignedByCheck.rows[0];
      }
    }

    // As a last resort, auto-provision a minimal employee record for this identifier
    if (!assignedByEmployee && isUuid(assigned_by)) {
      const usernameParts = (userRecord?.username || '').split(/[\s._-]+/).filter(Boolean);
      const placeholderFirst = titleCase(usernameParts[0]) || 'Director';
      const placeholderLast = titleCase(usernameParts.slice(1).join(' ')) || titleCase((userRecord?.role || '').replace(/_/g, ' ')) || 'Account';
      const sanitizedLocal = (userRecord?.username || '').replace(/[^a-z0-9]/gi, '').slice(0, 32).toLowerCase();
      const placeholderEmail = sanitizedLocal ? `${sanitizedLocal}@auto.local` : null;
      try {
        const autoEmployee = await client.query(`
          INSERT INTO employees (id, user_id, first_name, last_name, email)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, first_name, last_name
        `, [
          assigned_by,
          // If we do not have a confirmed user record, keep user_id NULL to avoid FK violations.
          userRecord?.id || null,
          placeholderFirst,
          placeholderLast,
          placeholderEmail
        ]);
        if (autoEmployee.rows.length > 0) {
          assignedByEmployee = autoEmployee.rows[0];
          console.warn('⚠️ Auto-created placeholder employee for assigned_by:', assignedByEmployee);
        } else {
          const requery = await client.query(
            'SELECT id, first_name, last_name FROM employees WHERE id = $1 LIMIT 1',
            [assigned_by]
          );
          assignedByEmployee = requery.rows[0] || null;
        }
      } catch (autoCreateError) {
        console.error('❌ Failed to auto-create placeholder employee for assigned_by:', assigned_by, autoCreateError);
      }
    }

    if (!assignedByEmployee) {
      console.error('❌ Could not find employee for assigned_by:', assigned_by);
      // Last attempt: check if it exists in users table at all
      const userExists = await client.query('SELECT id, username, role FROM users WHERE id = $1', [assigned_by]);
      console.error('   User exists in users table:', userExists.rows.length > 0 ? userExists.rows[0] : 'NO');

      // Check if employee exists with this user_id
      const empCheck = await client.query('SELECT id, user_id FROM employees WHERE user_id = $1', [assigned_by]);
      console.error('   Employee with this user_id:', empCheck.rows.length > 0 ? empCheck.rows[0] : 'NO');

      return res.status(400).json({
        error: `L'utilisateur avec l'ID ${assigned_by} n'existe pas dans la base de données (vérifié comme employee_id, employees.user_id, et via departments.responsible_id)`
      });
    }

    async function resolveEmployeeIdentifier(identifier) {
      if (!identifier) return null;
      const idStr = String(identifier);
      console.log(`🔍 Resolving employee identifier: ${idStr}`);

      // 1. Try direct employee id match
      let employeeRes = await client.query(
        'SELECT id, first_name, last_name FROM employees WHERE id = $1 LIMIT 1',
        [idStr]
      );
      if (employeeRes.rows.length > 0) {
        console.log(`✅ Found employee by id: ${idStr}`);
        return employeeRes.rows[0];
      }

      if (!isUuid(idStr)) {
        console.log(`❌ Not a valid UUID: ${idStr}`);
        return null;
      }

      // 2. Try via employees.user_id
      employeeRes = await client.query(
        'SELECT id, first_name, last_name FROM employees WHERE user_id = $1 LIMIT 1',
        [idStr]
      );
      if (employeeRes.rows.length > 0) {
        console.log(`✅ Found employee by user_id: ${idStr}`);
        return employeeRes.rows[0];
      }

      // 3. Try via users table and auto-provision if necessary
      const userLookup = await client.query(
        'SELECT id, username, role FROM users WHERE id = $1 LIMIT 1',
        [idStr]
      );
      const foundUser = userLookup.rows[0];

      // Generate placeholder data
      let placeholderFirst = 'Employee';
      let placeholderLast = 'Account';
      let placeholderEmail = null;
      let userIdForInsert = null;

      if (foundUser) {
        const usernameParts = (foundUser.username || '').split(/[\s._-]+/).filter(Boolean);
        placeholderFirst = titleCase(usernameParts[0]) || 'Employee';
        placeholderLast = titleCase(usernameParts.slice(1).join(' ')) || titleCase((foundUser.role || '').replace(/_/g, ' ')) || 'Account';
        const sanitizedLocal = (foundUser.username || '').replace(/[^a-z0-9]/gi, '').slice(0, 32).toLowerCase();
        placeholderEmail = sanitizedLocal ? `${sanitizedLocal}@auto.local` : null;
        userIdForInsert = foundUser.id;
      } else {
        // Even if user doesn't exist, create placeholder employee with NULL user_id
        console.log(`⚠️ User not found in users table for ${idStr}, creating placeholder employee with NULL user_id`);
      }

      try {
        const autoEmployee = await client.query(`
          INSERT INTO employees (id, user_id, first_name, last_name, email)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, first_name, last_name
        `, [
          idStr,
          userIdForInsert, // NULL if user doesn't exist, to avoid FK violation
          placeholderFirst,
          placeholderLast,
          placeholderEmail
        ]);
        if (autoEmployee.rows.length > 0) {
          console.warn(`⚠️ Auto-created placeholder employee for assignee:`, autoEmployee.rows[0]);
          return autoEmployee.rows[0];
        }
        // If ON CONFLICT triggered, retry query
        const retry = await client.query(
          'SELECT id, first_name, last_name FROM employees WHERE id = $1 LIMIT 1',
          [idStr]
        );
        if (retry.rows.length > 0) {
          console.log(`✅ Found employee after auto-create retry: ${idStr}`);
          return retry.rows[0];
        }
        console.error(`❌ Failed to create or find employee for: ${idStr}`);
        return null;
      } catch (autoAssigneeError) {
        console.error(`❌ Failed to auto-create placeholder assignee for: ${idStr}`, autoAssigneeError);
        return null;
      }
    }

    // Utiliser l'employee ID réel (pas le user_id)
    const actualEmployeeId = assignedByEmployee.id;
    console.log('✅ Found assigned_by user:', assignedByEmployee, 'Using employee_id:', actualEmployeeId);

    // Résoudre tous les assignés vers des IDs d'employés valides
    const resolvedAssigneeIds = [];
    console.log(`🔍 Resolving ${assignees.length} assignees:`, assignees);
    for (const rawAssigneeId of assignees) {
      const resolved = await resolveEmployeeIdentifier(rawAssigneeId);
      if (!resolved) {
        console.error(`❌ Failed to resolve assignee: ${rawAssigneeId}`);
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `L'employé avec l'ID ${rawAssigneeId} n'existe pas (vérifié via employee_id, employees.user_id, et tentative de création automatique)`
        });
      }
      console.log(`✅ Resolved assignee ${rawAssigneeId} -> employee ${resolved.id}`);
      resolvedAssigneeIds.push(resolved.id);
    }
    console.log(`✅ All ${resolvedAssigneeIds.length} assignees resolved successfully`);

    // Insertion de la tâche avec le bon assigned_by
    const taskResult = await client.query(`
      INSERT INTO tasks (title, description, type, assigned_by, due_date, priority)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      title,
      description || null,
      type,
      actualEmployeeId, // ✅ Utiliser l'employee ID réel (résolu depuis user_id si nécessaire)
      due_date || null,
      priority || 'Low'
    ]);

    const task = taskResult.rows[0];
    console.log('✅ Task created with assigned_by:', task.assigned_by);

    // Assigner la tâche à chaque employé sélectionné
    for (const employeeId of resolvedAssigneeIds) {
      const employeeCheck = await client.query(
        'SELECT id FROM employees WHERE id = $1',
        [employeeId]
      );

      if (employeeCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `L'employé avec l'ID ${employeeId} n'existe pas` });
      }

      await client.query(`
        INSERT INTO task_assignments (task_id, employee_id)
        VALUES ($1, $2)
      `, [task.id, employeeId]);
      console.log(`✅ Assigned task ${task.id} to employee ${employeeId}`);
    }

    await client.query('COMMIT');
    console.log(`✅ Task ${task.id} created and assigned to ${assignees.length} employee(s)`);

    // Récupérer la tâche complète
    const completeTaskResult = await pool.query(`
      SELECT 
        t.*,
        assigned_by_emp.first_name as assigned_by_first_name,
        assigned_by_emp.last_name as assigned_by_last_name,
        json_agg(
          json_build_object(
            'id', ta.employee_id,
            'first_name', e.first_name,
            'last_name', e.last_name,
            'status', ta.status,
            'assigned_at', ta.assigned_at,
            'completed_at', ta.completed_at
          )
        ) as assignees
      FROM tasks t
      LEFT JOIN employees assigned_by_emp ON t.assigned_by = assigned_by_emp.id
      LEFT JOIN task_assignments ta ON t.id = ta.task_id
      LEFT JOIN employees e ON ta.employee_id = e.id
      WHERE t.id = $1
      GROUP BY t.id, assigned_by_emp.first_name, assigned_by_emp.last_name
    `, [task.id]);

    console.log('✅ Complete task result:', completeTaskResult.rows[0]);

    // Notify assignees
    try {
      const assigneeIds = resolvedAssigneeIds;
      const byName = `${assignedByEmployee.first_name || ''} ${assignedByEmployee.last_name || ''}`.trim();

      // Notifier les assignés
      await Promise.all(assigneeIds.map(uid => createNotification({
        userId: uid,
        title: `Nouvelle tâche: ${title}`,
        body: byName ? `Assignée par ${byName}` : undefined,
        type: 'task_created',
        refType: 'task',
        refId: task.id
      })));

      // Si c'est une instruction du directeur (titre commence par "Instruction:"), notifier aussi les responsables des départements
      if (title && title.startsWith('Instruction:')) {
        try {
          // Récupérer les responsables des départements des employés assignés
          const responsibleIds = await pool.query(`
            SELECT DISTINCT d.responsible_id
            FROM departments d
            INNER JOIN employee_departments ed ON d.id = ed.department_id
            WHERE ed.employee_id = ANY($1::uuid[])
            AND d.responsible_id IS NOT NULL
          `, [assigneeIds]);

          // Notifier les responsables
          await Promise.all(responsibleIds.rows.map(row => createNotification({
            userId: row.responsible_id,
            title: `Nouvelle instruction: ${title}`,
            body: byName ? `Instruction envoyée par ${byName} aux employés de votre département` : `Nouvelle instruction pour votre département`,
            type: 'instruction_created',
            refType: 'task',
            refId: task.id
          })));
        } catch (e) {
          console.warn('Error notifying department responsibles:', e.message);
        }
      }
    } catch (_) { /* ignore notif errors */ }

    res.status(201).json({
      message: 'Task created successfully',
      task: completeTaskResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating task:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});


// Mettre à jour le statut d'un assigné et vérifier si la tâche est complète

// Version ultra-simple qui devrait marcher
app.put('/tasks/:taskId/assignees/:employeeId/status', async (req, res) => {
  try {
    const { taskId, employeeId } = req.params;
    const { status } = req.body;

    console.log('🔍 Update assignee status - taskId:', taskId, 'employeeId:', employeeId, 'status:', status);

    // First, try to resolve the employeeId (might be user_id or employee_id)
    let actualEmployeeId = employeeId;

    // Check if it's an employee ID first
    let employeeCheck = await pool.query(
      'SELECT id FROM employees WHERE id = $1',
      [employeeId]
    );

    // If not found, try as user_id
    if (employeeCheck.rows.length === 0) {
      employeeCheck = await pool.query(
        'SELECT id FROM employees WHERE user_id = $1',
        [employeeId]
      );

      if (employeeCheck.rows.length > 0) {
        actualEmployeeId = employeeCheck.rows[0].id;
        console.log('✅ Resolved user_id to employee_id:', employeeId, '->', actualEmployeeId);
      }
    }

    // Now update using the actual employee_id
    // Cast status to character varying to match column type
    const result = await pool.query(`
      UPDATE task_assignments 
      SET status = $3::character varying, 
          completed_at = CASE WHEN $3::text = 'Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE task_id = $1 
      AND employee_id = $2
      RETURNING *
    `, [taskId, actualEmployeeId, status]);

    if (result.rows.length === 0) {
      console.error('❌ Assignment not found - taskId:', taskId, 'employeeId:', actualEmployeeId);
      // Debug: check what assignments exist for this task
      const debugCheck = await pool.query(
        'SELECT task_id, employee_id FROM task_assignments WHERE task_id = $1',
        [taskId]
      );
      console.error('   Existing assignments for this task:', debugCheck.rows);
      return res.status(404).json({ error: 'Assignment not found' });
    }

    console.log('✅ Status updated successfully:', result.rows[0]);

    // Notifications côté backend
    try {
      if (String(status) === 'Completed') {
        // Trouver le créateur de la tâche et le titre
        const tRes = await pool.query(`SELECT id, title, assigned_by FROM tasks WHERE id = $1`, [taskId]);
        const t = tRes.rows?.[0];
        if (t && t.assigned_by) {
          // Récupérer le nom de l'employé qui a complété la tâche
          const employeeRes = await pool.query(
            `SELECT first_name, last_name FROM employees WHERE id = $1`,
            [employeeId]
          );
          const employeeName = employeeRes.rows?.[0]
            ? `${employeeRes.rows[0].first_name || ''} ${employeeRes.rows[0].last_name || ''}`.trim()
            : `Employé ${employeeId}`;

          // 1) Informer le créateur qu'un assigné a terminé
          await createNotification({
            userId: t.assigned_by,
            title: `Un assigné a terminé: ${t.title || ''}`,
            body: `${employeeName} a marqué la tâche comme complétée`,
            type: 'assignment_completed',
            refType: 'task',
            refId: taskId
          });
          // 2) Si tous les assignés sont terminés → informer créateur (tâche complétée)
          const allRes = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE status <> 'Completed') AS remaining
             FROM task_assignments WHERE task_id = $1`, [taskId]
          );
          const remaining = parseInt(allRes.rows?.[0]?.remaining || '0', 10);
          if (remaining === 0) {
            await createNotification({
              userId: t.assigned_by,
              title: `Tâche complétée: ${t.title || ''}`,
              body: `Tous les assignés ont terminé la tâche`,
              type: 'task_completed',
              refType: 'task',
              refId: taskId
            });
          }
        }
      }
    } catch (_) { /* noop */ }

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Get task by ID with comments
app.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        t.*,
        assigned_by_emp.first_name as assigned_by_first_name,
        assigned_by_emp.last_name as assigned_by_last_name,
        COALESCE(users.role, 
          (SELECT u2.role FROM users u2 WHERE u2.id = assigned_by_emp.user_id LIMIT 1)
        ) as assigned_by_role,
        json_agg(
          json_build_object(
            'id', ta.employee_id,
            'first_name', e.first_name,
            'last_name', e.last_name,
            'status', ta.status,
            'assigned_at', ta.assigned_at,
            'completed_at', ta.completed_at
          )
        ) as assignees
      FROM tasks t
      LEFT JOIN employees assigned_by_emp ON t.assigned_by = assigned_by_emp.id
      LEFT JOIN users ON assigned_by_emp.user_id = users.id
      LEFT JOIN task_assignments ta ON t.id = ta.task_id
      LEFT JOIN employees e ON ta.employee_id = e.id
      WHERE t.id = $1
      GROUP BY t.id, assigned_by_emp.first_name, assigned_by_emp.last_name, users.role
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Filtrer les assignés nulls
    const task = result.rows[0];
    task.assignees = (task.assignees || []).filter(a => a && a.id !== null);

    // Attacher les commentaires
    const commentsRes = await pool.query(`
      SELECT 
        tc.id,
        tc.comment AS text,
        tc.created_at,
        e.first_name || ' ' || e.last_name AS author_name,
        e.id AS employee_id
      FROM task_comments tc
      JOIN employees e ON e.id = tc.employee_id
      WHERE tc.task_id = $1
      ORDER BY tc.created_at DESC
    `, [id]);
    task.comments = commentsRes.rows || [];

    // Attacher les rapports
    const reportsRes = await pool.query(`
      SELECT 
        r.id,
        r.description AS content,
        r.remarks,
        r.created_at,
        r.pdf_url,
        e.first_name || ' ' || e.last_name AS author_name,
        e.id AS employee_id
      FROM reports r
      JOIN employees e ON e.id = r.employee_id
      WHERE r.task_id = $1
      ORDER BY r.created_at DESC
    `, [id]);
    task.reports = reportsRes.rows || [];

    res.json(task);
  } catch (error) {
    console.error('Get task by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new task - version sans utilisateur connecté
// Create new task



// Update task - version simplifiée sans authentification
app.put('/tasks/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { title, description, type, priority, due_date, assigned_to } = req.body;

    // Vérifier que la tâche existe
    const currentTask = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (currentTask.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task not found' });
    }

    // Mettre à jour la table tasks
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updateFields.push(`title = $${paramCount}`);
      values.push(title);
      paramCount++;
    }

    if (description !== undefined) {
      updateFields.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    if (type !== undefined) {
      updateFields.push(`type = $${paramCount}`);
      values.push(type);
      paramCount++;
    }

    if (priority !== undefined) {
      updateFields.push(`priority = $${paramCount}`);
      values.push(priority);
      paramCount++;
    }

    if (due_date !== undefined) {
      updateFields.push(`due_date = $${paramCount}`);
      values.push(due_date || null);
      paramCount++;
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);
      const query = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;

      const result = await client.query(query, values);
    }

    // Si assigned_to est fourni, mettre à jour les assignations
    if (assigned_to && Array.isArray(assigned_to)) {
      // Supprimer toutes les assignations existantes
      await client.query('DELETE FROM task_assignments WHERE task_id = $1', [id]);

      // Ajouter les nouvelles assignations
      for (const employeeId of assigned_to) {
        // Vérifier que l'employé existe
        const employeeCheck = await client.query(
          'SELECT id FROM employees WHERE id = $1',
          [employeeId]
        );

        if (employeeCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Employee with ID ${employeeId} does not exist` });
        }

        await client.query(`
          INSERT INTO task_assignments (task_id, employee_id, status)
          VALUES ($1, $2, 'Pending')
        `, [id, employeeId]);
      }
    }

    await client.query('COMMIT');

    // Récupérer la tâche mise à jour avec ses assignés
    const updatedTaskResult = await pool.query(`
      SELECT 
        t.*,
        assigned_by_emp.first_name as assigned_by_first_name,
        assigned_by_emp.last_name as assigned_by_last_name,
        json_agg(
          json_build_object(
            'id', ta.employee_id,
            'first_name', e.first_name,
            'last_name', e.last_name,
            'status', ta.status,
            'assigned_at', ta.assigned_at,
            'completed_at', ta.completed_at
          )
        ) as assignees
      FROM tasks t
      LEFT JOIN employees assigned_by_emp ON t.assigned_by = assigned_by_emp.id
      LEFT JOIN task_assignments ta ON t.id = ta.task_id
      LEFT JOIN employees e ON ta.employee_id = e.id
      WHERE t.id = $1
      GROUP BY t.id, assigned_by_emp.first_name, assigned_by_emp.last_name
    `, [id]);

    res.json({
      message: 'Task updated successfully',
      task: updatedTaskResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update task error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Delete task - version simplifiée sans authentification
app.delete('/tasks/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Vérifier que la tâche existe
    const currentTask = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (currentTask.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task not found' });
    }

    // Supprimer les commentaires associés
    await client.query('DELETE FROM task_comments WHERE task_id = $1', [id]);

    // Supprimer les assignations (déjà configuré en CASCADE dans la BD)
    await client.query('DELETE FROM task_assignments WHERE task_id = $1', [id]);

    // Supprimer la tâche
    const deleteResult = await client.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);

    await client.query('COMMIT');

    res.json({
      message: 'Task deleted successfully',
      deleted_task: deleteResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete task error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Add comment to task - version simplifiée sans authentification
app.post('/tasks/:taskId/comments', async (req, res) => {
  try {
    const { taskId } = req.params;
    // Accept both employee_id and employeeId for compatibility
    const { comment, employee_id, employeeId } = req.body;
    const finalEmployeeId = employee_id || employeeId;

    if (!comment || !finalEmployeeId) {
      return res.status(400).json({
        success: false,
        error: 'Comment and employee ID are required',
        received: { comment: !!comment, employee_id: !!employee_id, employeeId: !!employeeId }
      });
    }

    // Verify task exists
    const taskCheck = await pool.query('SELECT id FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Verify employee exists
    const employeeCheck = await pool.query('SELECT id FROM employees WHERE id = $1', [finalEmployeeId]);
    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    // Insert comment
    const result = await pool.query(`
      INSERT INTO task_comments (task_id, employee_id, comment)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [taskId, finalEmployeeId, comment]);

    // Get complete comment details
    const commentWithDetails = await pool.query(`
      SELECT 
        tc.id,
        tc.comment,
        tc.created_at,
        e.id as employee_id,
        e.first_name,
        e.last_name
      FROM task_comments tc
      JOIN employees e ON tc.employee_id = e.id
      WHERE tc.id = $1
    `, [result.rows[0].id]);

    // Notifications: to all assignees + task author if different
    try {
      const taskRes = await pool.query('SELECT assigned_by, title FROM tasks WHERE id = $1', [taskId]);
      const assigneesRes = await pool.query('SELECT employee_id FROM task_assignments WHERE task_id = $1', [taskId]);
      const assigneeIds = (assigneesRes.rows || []).map(r => r.employee_id).filter(Boolean);
      const targets = new Set(assigneeIds.concat(taskRes.rows?.[0]?.assigned_by ? [taskRes.rows[0].assigned_by] : []));
      targets.delete(finalEmployeeId); // don't notify author of the comment
      const authorNameRes = await pool.query('SELECT first_name, last_name FROM employees WHERE id = $1', [finalEmployeeId]);
      const authorName = authorNameRes.rows?.[0] ? `${authorNameRes.rows[0].first_name || ''} ${authorNameRes.rows[0].last_name || ''}`.trim() : '';
      await Promise.all(Array.from(targets).map(uid => createNotification({
        userId: uid,
        title: `Nouveau commentaire`,
        body: authorName ? `${authorName} a commenté la tâche "${taskRes.rows?.[0]?.title || ''}"` : `Nouveau commentaire sur "${taskRes.rows?.[0]?.title || ''}"`,
        type: 'comment_added',
        refType: 'task',
        refId: taskId
      })));
    } catch (_) { /* ignore notif errors */ }

    res.status(201).json({
      success: true,
      comment: commentWithDetails.rows[0],
      message: 'Comment added successfully'
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add comment',
      details: error.message
    });
  }
});

// Get task statistics for dashboard
app.get('/tasks/stats/dashboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM tasks
      GROUP BY status
    `);

    const stats = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      not_done: 0
    };

    result.rows.forEach(row => {
      const status = row.status.toLowerCase().replace(' ', '_');
      stats[status] = parseInt(row.count);
    });

    res.json(stats);
  } catch (error) {
    console.error('Get task stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route pour générer un UUID (optionnel)
app.get('/generate-uuid', (req, res) => {
  res.json({ uuid: uuidv4() });
});

// Error handling middleware
// Middleware de logging
// Middleware de logging - VERSION CORRIGÉE
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  // Vérifier que req.body existe avant d'utiliser Object.keys()
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', req.body);
  }

  // Vérifier que req.params existe avant d'utiliser Object.keys()
  if (req.params && Object.keys(req.params).length > 0) {
    console.log('Params:', req.params);
  }

  next();
});
// (duplicate start removed; server starts earlier with ensureNotificationsTable)
app.get('/tasks/:taskId/comments', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Vérifier que la tâche existe
    const taskCheck = await pool.query('SELECT id FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Récupérer les commentaires
    const result = await pool.query(`
      SELECT 
        tc.id,
        tc.comment,
        tc.created_at,
        e.id as employee_id,
        e.first_name,
        e.last_name
      FROM task_comments tc
      JOIN employees e ON tc.employee_id = e.id
      WHERE tc.task_id = $1
      ORDER BY tc.created_at DESC
    `, [taskId]);

    // CORRECTION : Vérifier si result.rows existe avant de l'utiliser
    const comments = result.rows || [];

    res.json({
      success: true,
      comments: comments // Utiliser la variable vérifiée
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments'
    });
  }
});

// 2. Route POST pour ajouter un commentaire
app.post('/tasks/:taskId/comments', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { comment, employeeId } = req.body;

    if (!comment || !employeeId) {
      return res.status(400).json({
        success: false,
        error: 'Comment and employee ID are required'
      });
    }

    // Vérifier si la tâche existe
    const taskCheck = await pool.query('SELECT id FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Vérifier si l'employé existe
    const employeeCheck = await pool.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    // Insérer le commentaire
    const result = await pool.query(`
      INSERT INTO task_comments (task_id, employee_id, comment)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [taskId, employeeId, comment]);

    // Récupérer les informations complètes du commentaire
    const commentWithDetails = await pool.query(`
      SELECT 
        tc.id,
        tc.comment,
        tc.created_at,
        e.id as employee_id,
        e.first_name,
        e.last_name
      FROM task_comments tc
      JOIN employees e ON tc.employee_id = e.id
      WHERE tc.id = $1
    `, [result.rows[0].id]);

    res.status(201).json({
      success: true,
      comment: commentWithDetails.rows[0],
      message: 'Comment added successfully'
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add comment'
    });
  }
});

// PUT /api/comments/:commentId - Modifier un commentaire
// PUT /api/comments/:commentId - Modifier un commentaire
// PUT /comments/:commentId - Modifier un commentaire (CORRIGÉ)
app.put('/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { comment, employee_id, employeeId } = req.body;
    const finalEmployeeId = employee_id || employeeId;

    if (!comment) {
      return res.status(400).json({
        success: false,
        error: 'Comment is required'
      });
    }

    // Vérifier si le commentaire existe et appartient à l'employé
    const commentCheck = await pool.query(
      'SELECT * FROM task_comments WHERE id = $1 AND employee_id = $2',
      [commentId, finalEmployeeId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found or unauthorized'
      });
    }

    // Mettre à jour le commentaire
    const result = await pool.query(`
      UPDATE task_comments 
      SET comment = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [comment, commentId]);

    // Récupérer les détails complets du commentaire mis à jour
    const updatedComment = await pool.query(`
      SELECT 
        tc.id,
        tc.comment,
        tc.created_at,
        tc.updated_at,
        e.id as employee_id,
        e.first_name,
        e.last_name
      FROM task_comments tc
      JOIN employees e ON tc.employee_id = e.id
      WHERE tc.id = $1
    `, [commentId]);

    res.json({
      success: true,
      comment: updatedComment.rows[0],
      message: 'Comment updated successfully'
    });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update comment: ' + error.message
    });
  }
});

// DELETE /comments/:commentId - Supprimer un commentaire (CORRIGÉ)
app.delete('/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { employee_id, employeeId } = req.body;
    const finalEmployeeId = employee_id || employeeId;

    if (!finalEmployeeId) {
      return res.status(400).json({
        success: false,
        error: 'Employee ID is required'
      });
    }

    // Vérifier si le commentaire existe et appartient à l'employé
    const commentCheck = await pool.query(
      'SELECT * FROM task_comments WHERE id = $1 AND employee_id = $2',
      [commentId, finalEmployeeId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found or unauthorized'
      });
    }

    // Supprimer le commentaire
    await pool.query(
      'DELETE FROM task_comments WHERE id = $1',
      [commentId]
    );

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete comment: ' + error.message
    });
  }
});
app.get('/director/overview', async (req, res) => {
  try {
    // Récupérer les statistiques globales
    const employeeCount = await pool.query('SELECT COUNT(*) FROM employees');
    const taskStats = await pool.query(`
      SELECT status, COUNT(*) 
      FROM tasks 
      GROUP BY status
    `);
    const departmentStats = await pool.query(`
      SELECT d.name, COUNT(e.id) as employee_count
      FROM departments d
      LEFT JOIN employee_departments ed ON d.id = ed.department_id
      LEFT JOIN employees e ON ed.employee_id = e.id
      GROUP BY d.id, d.name
    `);

    res.json({
      employeeCount: employeeCount.rows[0].count,
      taskStats: taskStats.rows,
      departmentStats: departmentStats.rows
    });
  } catch (error) {
    console.error('Error fetching director overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/director/department-performance', async (req, res) => {
  try {
    const performanceData = await pool.query(`
      SELECT d.name, 
             COUNT(DISTINCT e.id) as employee_count,
             AVG(CASE WHEN ta.status = 'Completed' THEN 1 ELSE 0 END) * 100 as completion_rate
      FROM departments d
      LEFT JOIN employee_departments ed ON d.id = ed.department_id
      LEFT JOIN employees e ON ed.employee_id = e.id
      LEFT JOIN task_assignments ta ON e.id = ta.employee_id
      GROUP BY d.id, d.name
      ORDER BY completion_rate DESC
    `);

    res.json(performanceData.rows);
  } catch (error) {
    console.error('Error fetching department performance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = app;