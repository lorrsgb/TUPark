const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // NEW: Production Session Store
const { Pool } = require('pg'); // PostgreSQL client
const bcrypt = require('bcrypt'); 
const app = express();
const PORT = process.env.PORT || 3000; 
const rateLimit = require('express-rate-limit'); 

// Define the Limiter
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 1000, 
    message: "Too many requests from this IP, please try again later."
});

app.use(limiter);

// ==========================================
// 1. APP CONFIGURATION
// ==========================================
// NEW: Required for Vercel/Render. Allows express-rate-limit to correctly read the user's IP address.
app.set('trust proxy', 1); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const loginAttempts = {};

// ==========================================
// 2. DATABASE CONNECTION (PostgreSQL/Supabase)
// ==========================================
const pool = new Pool({
    // Reads credentials from Environment Variables (Vercel/Render) or uses fallbacks.
    user: process.env.DB_USER || 'postgres', 
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres', 
    password: process.env.DB_PASSWORD || 'your_local_password_here', 
    port: process.env.DB_PORT || 5432, 
    // FINAL FIX: Hardened SSL configuration for deployment platforms
    ssl: process.env.DB_HOST ? { 
        rejectUnauthorized: false
    } : false
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('Error connecting to PostgreSQL:', err);
    else console.log('Connected to PostgreSQL Database!');
});

// --- SESSION CONFIGURATION (PRODUCTION SAFE) ---
app.use(session({
    // Store sessions in the Postgres database, fixing the memory leak error.
    store: new pgSession({
        pool: pool, 
        tableName: 'user_sessions' 
    }),
    secret: 'tupark-secret-key', 
    resave: false,
    saveUninitialized: true,
    rolling: true, 
    cookie: { 
        maxAge: 15 * 60 * 1000, 
        secure: process.env.NODE_ENV === 'production', // Secure cookies are required when hosted (Vercel)
        httpOnly: true,
        sameSite: 'lax'
    }
}));


// ==========================================
// 3. ACTIVITY LOGGING HELPER (POSTGRESQL SYNTAX)
// ==========================================
async function logActivity(username, action, details, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    try {
        const insertSql = 'INSERT INTO activity_logs (username, action, details, ip_address) VALUES ($1, $2, $3, $4)';
        await pool.query(insertSql, [username, action, details, ip]);
        
        const cleanupSql = `
            DELETE FROM activity_logs 
            WHERE id NOT IN (
                SELECT id FROM activity_logs ORDER BY id DESC LIMIT 100
            )
        `;
        await pool.query(cleanupSql);
    } catch (err) {
        console.error("Logging Error:", err);
    }
}

// ==========================================
// 4. SECURITY MIDDLEWARE
// ==========================================
function checkAuth(req, res, next) {
    if (req.session.isLoggedIn) {
        next(); 
    } else {
        res.redirect('/login-page'); 
    }
}

// ==========================================
// 5. PAGE ROUTES
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'landing.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'dashboard.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'demo.html')));
app.get('/report-problem', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'report-problem.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'about.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'contact.html')));
app.get('/features', (req, res) => res.sendFile(path.join(__dirname, 'views', 'user', 'features.html')));
app.get('/login-page', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admindemo.html')));
app.get('/admin/reports', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'Report.html')));


// ==========================================
// 6. API ROUTES (POSTGRESQL REWRITE)
// ==========================================

// --- LOGOUT ROUTE ---
app.get('/logout', (req, res) => {
    if (req.session.username) {
        logActivity(req.session.username, 'LOGOUT', 'Admin logged out manually', req);
    }
    req.session.destroy((err) => {
        if (err) console.error("Logout Error:", err);
        res.redirect('/login-page');
    });
});

app.post('/api/session-timeout', (req, res) => {
    if (req.session.username) {
        logActivity(req.session.username, 'SESSION_TIMEOUT', 'System auto-logout due to inactivity', req);
    }
    req.session.destroy(() => { res.json({ success: true }); });
});

// --- LOGIN LOGIC ---
app.post('/login', async (req, res) => { 
    const { adminId, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    if (loginAttempts[ip] && loginAttempts[ip].lockUntil > now) {
        const timeLeft = Math.ceil((loginAttempts[ip].lockUntil - now) / 1000);
        return res.json({ success: false, message: `Account Locked. Try again in ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s.` });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [adminId]);
        const results = result.rows; 
        
        let loginSuccess = false;

        if (results.length > 0) {
            const match = await bcrypt.compare(password, results[0].password);
            if (match) loginSuccess = true;
        }

        if (loginSuccess) {
            if (loginAttempts[ip]) delete loginAttempts[ip]; 
            req.session.isLoggedIn = true;
            req.session.username = adminId;
            await logActivity(adminId, 'LOGIN', 'Admin logged in successfully', req);
            res.json({ success: true });
        } else {
            await logActivity(adminId || 'Unknown', 'LOGIN_FAILED', 'Failed login attempt', req); 
            
            if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, lockUntil: null };
            loginAttempts[ip].count++;
            if (loginAttempts[ip].count >= 3) {
                loginAttempts[ip].lockUntil = now + 300000; 
                return res.json({ success: false, message: "Too many failed attempts. You are BLOCKED for 5 minutes." });
            }
            res.status(401).json({ success: false, message: `Invalid Account. ${3 - loginAttempts[ip].count} attempts remaining.` });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// --- GET PARKING SPOTS ---
app.get('/api/spots', async (req, res) => { 
    try {
        const result = await pool.query('SELECT * FROM slots');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

// --- GET ACTIVITY LOGS ---
app.get('/api/logs', checkAuth, async (req, res) => { 
    try {
        const result = await pool.query('SELECT * FROM activity_logs ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

// --- UPDATE SPOT ---
app.post('/api/update-spot', async (req, res) => { 
    const { slot_id, status, plate_number, park_time, vehicle_type } = req.body;
    const currentUser = req.session.username || 'Unknown Admin'; 

    try {
        if (status === 'occupied') {
            const plateRegex = /^[A-Z]{3}[- ]?\d{3,4}$/;
            if (!plate_number || !plateRegex.test(plate_number)) return res.json({ success: false, message: "Invalid Plate Number!" });
            if (!['Car', 'Motorcycle', 'Van', 'Others'].includes(vehicle_type)) return res.json({ success: false, message: "Invalid Vehicle Type." });
            
            // Check for duplicates
            const checkResult = await pool.query('SELECT * FROM slots WHERE plate_number = $1 AND status = $2 AND slot_number != $3', [plate_number, 'occupied', slot_id]);
            if (checkResult.rows.length > 0) return res.json({ success: false, message: `Error: Vehicle ${plate_number} is already parked at ${checkResult.rows[0].slot_number}!` });
            
            await executeUpdate(currentUser);
        } else {
            await executeUpdate(currentUser);
        }
    } catch (err) {
        console.error("Update Spot Error:", err);
        res.status(500).json({ success: false, message: "Database Operation Failed" });
    }

    async function executeUpdate(user) {
        // Postgres query uses $1, $2, etc.
        const sql = 'UPDATE slots SET status = $1, plate_number = $2, start_time = $3, vehicle_type = $4 WHERE slot_number = $5';
        await pool.query(sql, [status, plate_number, park_time, vehicle_type, slot_id]);
        
        const actionType = status === 'occupied' ? 'OCCUPY_SPOT' : 'RELEASE_SPOT';
        const details = status === 'occupied' ? `Parked ${plate_number} (${vehicle_type}) at ${slot_id}` : `Released spot ${slot_id}`;
        await logActivity(user, actionType, details, req);
        res.json({ success: true });
    }
});

// --- USER REPORT SUBMISSION ---
app.post('/api/submit-report', async (req, res) => { 
    // MODIFIED: Destructure slot_id from the request body
    const { category, description, name, plate, slot_id } = req.body; 
    
    // MODIFIED: Check for all required fields including slot_id
    if (!category || !description || !name || !plate || !slot_id) return res.json({ success: false, message: "All fields are required." });

    try {
        // NEW: VERIFY PLATE AND SLOT_ID MATCH IN DATABASE
        const checkMatchSql = 'SELECT * FROM slots WHERE plate_number = $1 AND slot_number = $2 AND status = $3';
        // Use slot_id and plate from the request to check for a match
        const checkResult = await pool.query(checkMatchSql, [plate, slot_id, 'occupied']); 

        if (checkResult.rows.length === 0) {
            // Error message indicates which check failed
            return res.json({ success: false, message: `Report Failed: Vehicle ${plate} at slot ${slot_id} is not currently recorded as occupied in our system.` });
        }

        // Plate/Slot Match is successful, proceed with inserting the report
        const insertSql = 'INSERT INTO problem_reports (category, description, reporter_name, plate_number) VALUES ($1, $2, $3, $4)';
        await pool.query(insertSql, [category, description, name, plate]);
        res.json({ success: true });
    } catch (err) {
        console.error("Submit Report Error:", err);
        res.json({ success: false, message: "Server error during report submission." });
    }
});

// --- ADMIN REPORT ACTIONS ---
app.get('/api/admin/reports', checkAuth, async (req, res) => { 
    try {
        const result = await pool.query('SELECT * FROM problem_reports ORDER BY report_date DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.delete('/api/admin/reports/:id', checkAuth, async (req, res) => { 
    const reportId = req.params.id;
    try {
        await pool.query('DELETE FROM problem_reports WHERE id = $1', [reportId]);
        await logActivity(req.session.username || 'Admin', 'DELETE_REPORT', `Deleted report ID: ${reportId}`, req);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: "Database Error" });
    }
});

// Helper for hashing
app.post('/api/hash-password', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    res.json({ hashed: hash });
});

// Export the app for Vercel/Render
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;