const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); 
const { Pool } = require('pg'); 
const bcrypt = require('bcrypt'); 
const rateLimit = require('express-rate-limit'); 
const passport = require('passport'); // NEW: For Google OAuth
const GoogleStrategy = require('passport-google-oauth20').Strategy; // NEW: Google Strategy

const app = express();
const PORT = process.env.PORT || 3000; 

// --- GOOGLE OAUTH CONFIGURATION ---
// IMPORTANT: Use Environment Variables in Vercel for these values.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID'; 
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET'; 
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://tupark.vercel.app/auth/google/callback'; 

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
app.set('trust proxy', 1); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. DATABASE CONNECTION
// ==========================================
const pool = new Pool({
    user: process.env.DB_USER || 'postgres', 
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres', 
    password: process.env.DB_PASSWORD || 'your_local_password_here', 
    port: process.env.DB_PORT || 5432, 
    ssl: process.env.DB_HOST ? { 
        rejectUnauthorized: false
    } : false
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('Error connecting to PostgreSQL:', err);
    else console.log('Connected to PostgreSQL Database!');
});

// --- SESSION CONFIGURATION ---
app.use(session({
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
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// ==========================================
// 3. PASSPORT.JS CONFIGURATION
// ==========================================

// Serialize: Store 'username' (Admin ID for logs) in the session
passport.serializeUser((user, done) => {
    done(null, user.username); 
});

// Deserialize: Retrieve user object using the 'username' from the session
passport.deserializeUser(async (username, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        done(null, user); 
    } catch (err) {
        done(err, null);
    }
});

// Google Strategy: Check if the returned Google email is authorized
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL
},
async (accessToken, refreshToken, profile, done) => {
    const googleEmail = profile.emails[0].value; 

    try {
        // Find user by authorized Gmail address (requires 'email' column in users table)
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [googleEmail]);
        const user = result.rows[0];

        if (!user) {
            // User is NOT authorized (email not found in DB)
            return done(null, false, { message: 'This Google account is not authorized for TUPark Admin access.' });
        }
        
        // Success: Google handled 2FA, and the email is authorized.
        // The user object must contain the 'username' field for serialization.
        return done(null, user); 
    } catch (err) {
        return done(err, null);
    }
}));

// Initialize Passport middleware
app.use(passport.initialize());
app.use(passport.session());


// ==========================================
// 4. ACTIVITY LOGGING HELPER
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
// 5. SECURITY MIDDLEWARE
// ==========================================
function checkAuth(req, res, next) {
    // Check if Passport has successfully deserialized a user (Is authenticated)
    if (req.isAuthenticated()) {
        next(); 
    } else {
        // Store intended URL and redirect to login page
        req.session.returnTo = req.originalUrl;
        res.redirect('/login-page'); 
    }
}

// ==========================================
// 6. PAGE ROUTES
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
// 7. AUTHENTICATION & API ROUTES
// ==========================================

// --- GOOGLE OAUTH ROUTES (NEW LOGIN MECHANISM) ---

// Route 1: Initiates the Google login process (sends user to Google's site)
app.get('/auth/google',
    passport.authenticate('google', { 
        scope: ['email', 'profile'] 
    })
);

// Route 2: Receives the callback from Google (verification check)
app.get('/auth/google/callback',
    passport.authenticate('google', { 
        failureRedirect: '/login-page' // Redirect to login on failure
    }),
    async (req, res) => {
        // Success! Log activity using the username retrieved from the DB
        await logActivity(req.user.username, 'LOGIN_OAUTH', 'Admin logged in via Google OAuth 2.0', req);
        
        // Redirect to the stored URL or /admin
        const redirectUrl = req.session.returnTo || '/admin';
        delete req.session.returnTo; 
        res.redirect(redirectUrl); 
    }
);


// --- LOGOUT ROUTE ---
app.get('/logout', (req, res, next) => {
    if (req.user && req.user.username) {
        logActivity(req.user.username, 'LOGOUT', 'Admin logged out manually', req);
    }
    // Passport logout functionality
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.redirect('/login-page');
        });
    });
});

app.post('/api/session-timeout', (req, res, next) => {
    if (req.user && req.user.username) {
        logActivity(req.user.username, 'SESSION_TIMEOUT', 'System auto-logout due to inactivity', req);
    }
    // Use Passport logout before destroying session
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => { 
            res.json({ success: true }); 
        });
    });
});

// --- REMOVED: app.post('/login', ...) manual login logic is no longer needed ---

// --- Existing API Routes remain here ---

// --- GET PARKING SPOTS ---
app.get('/api/spots', async (req, res) => { 
    try {
        // Query to convert the start_time (assuming it's stored as TIMESTAMP WITHOUT TIMEZONE
        // or a similar type) to the 'Asia/Manila' timezone before returning it.
        const result = await pool.query(`
            SELECT 
                slot_number, 
                status, 
                plate_number,
                vehicle_type,
                -- Convert and format the time for PH
                TO_CHAR(start_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS start_time 
            FROM slots
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching spots:", err);
        res.status(500).json({ message: "Server error fetching spots." });
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

// --- UPDATE PARKING SPOT ---
app.post('/api/update-spot', async (req, res) => { // ADD async HERE
    const { slot_id, status, plate_number, park_time, vehicle_type } = req.body;
    // req.user comes from passport. If not, fallback to session username or 'Unknown Admin'.
    const currentUser = req.user ? req.user.username : req.session.username || 'Unknown Admin'; 

    try { // Use a single try/catch block for robust error handling

        // === OCCUPY LOGIC (Validation and Duplicate Check) ===
        if (status === 'occupied') {
            const plateRegex = /^[A-Z]{3}[- ]?\d{3,4}$/;
            if (!plate_number || !plateRegex.test(plate_number)) {
                return res.json({ success: false, message: "Invalid Plate Number! Format must be LLL-DDD or LLL-DDDD (e.g., ABC-123)." });
            }

            const validTypes = ['Car', 'Motorcycle', 'Van', 'Others'];
            if (!validTypes.includes(vehicle_type)) {
                return res.json({ success: false, message: "Invalid Vehicle Type selected." });
            }

            if (plate_number.length > 15) {
                return res.json({ success: false, message: "Plate number is too long." });
            }

            // PostgreSQL Query for Duplicate Check (Uses $1, $2, and async/await)
            const checkSql = 'SELECT slot_number FROM slots WHERE plate_number = $1 AND status = $2 AND slot_number != $3';
            const checkResult = await pool.query(checkSql, [plate_number, 'occupied', slot_id]);
            
            if (checkResult.rows.length > 0) {
                return res.json({ 
                    success: false, 
                    message: `Error: Vehicle ${plate_number} is already parked at ${checkResult.rows[0].slot_number}!` 
                });
            }
        } 
        
        // === EXECUTE UPDATE (For both 'occupied' and 'available') ===
        const sql = 'UPDATE slots SET status = $1, plate_number = $2, start_time = $3, vehicle_type = $4 WHERE slot_number = $5';
        
        // Ensure plate_number, park_time, and vehicle_type are correctly passed as null for 'available' status
        const plate = status === 'available' ? null : plate_number;
        const time = status === 'available' ? null : park_time;
        const type = status === 'available' ? null : vehicle_type;
        
        await pool.query(sql, [status, plate, time, type, slot_id]);

        // === LOG ACTIVITY ===
        const actionType = status === 'occupied' ? 'OCCUPY_SPOT' : 'RELEASE_SPOT';
        const details = status === 'occupied' 
            ? `Parked ${plate_number} (${vehicle_type}) at ${slot_id}`
            : `Released spot ${slot_id}`;
            
        await logActivity(currentUser, actionType, details, req);

        res.json({ success: true });

    } catch (err) {
        console.error("Update Spot Database Error:", err);
        // Respond with a clean JSON error response
        res.status(500).json({ success: false, message: "Database Error during spot update." });
    }
});

// --- USER REPORT SUBMISSION ---
app.post('/api/submit-report', async (req, res) => { 
    const { category, description, name, plate, slot_id } = req.body; 
    
    if (!category || !description || !name || !plate || !slot_id) return res.json({ success: false, message: "All fields are required." });

    try {
        const checkMatchSql = 'SELECT * FROM slots WHERE plate_number = $1 AND slot_number = $2 AND status = $3';
        const checkResult = await pool.query(checkMatchSql, [plate, slot_id, 'occupied']); 

        if (checkResult.rows.length === 0) {
            return res.json({ success: false, message: `Report Failed: Vehicle ${plate} at slot ${slot_id} is not currently recorded as occupied in our system.` });
        }

        const insertSql = 'INSERT INTO problem_reports (category, description, reporter_name, plate_number, slot_number) VALUES ($1, $2, $3, $4, $5)';
        await pool.query(insertSql, [category, description, name, plate, slot_id]);
        
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
        const logUsername = req.user && req.user.username ? req.user.username : 'Unknown Admin';
        await pool.query('DELETE FROM problem_reports WHERE id = $1', [reportId]);
        await logActivity(logUsername, 'DELETE_REPORT', `Deleted report ID: ${reportId}`, req);
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

// Export the app for Vercel/Render test
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;