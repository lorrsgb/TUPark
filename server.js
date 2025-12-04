const express = require('express');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2');
const bcrypt = require('bcrypt'); // Make sure you have installed this: npm install bcrypt
const app = express();
const PORT = 3000;
const rateLimit = require('express-rate-limit'); // Make sure you have installed this: npm install express-rate-limit

// Define the Limiter
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: 500, // Increased limit for development
    message: "Too many requests from this IP, please try again later."
});

// Apply to all requests
app.use(limiter);

// ==========================================
// 1. APP CONFIGURATION
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION CONFIGURATION ---
app.use(session({
    secret: 'tupark-secret-key', 
    resave: false,
    saveUninitialized: true,
    rolling: true, 
    cookie: { 
        maxAge: 15 * 60 * 1000 // 15 Minutes
    }
}));

// --- LOGIN ATTEMPT TRACKER ---
const loginAttempts = {}; 

// ==========================================
// 2. DATABASE CONNECTION
// ==========================================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'tupark-db' 
});

db.connect((err) => {
    if (err) console.error('Error connecting to MySQL:', err);
    else console.log('Connected to MySQL Database!');
});

// ==========================================
// 3. ACTIVITY LOGGING HELPER
// ==========================================
function logActivity(username, action, details, req) {
    const ip = req.ip || req.connection.remoteAddress;
    
    const insertSql = 'INSERT INTO activity_logs (username, action, details, ip_address) VALUES (?, ?, ?, ?)';
    
    db.query(insertSql, [username, action, details, ip], (err) => {
        if (err) {
            console.error("Logging Error:", err);
        } else {
            const cleanupSql = `
                DELETE FROM activity_logs 
                WHERE id NOT IN (
                    SELECT id FROM (
                        SELECT id FROM activity_logs ORDER BY id DESC LIMIT 100
                    ) AS keep_rows
                )
            `;
            db.query(cleanupSql, (cleanErr) => {
                if (cleanErr) console.error("Log Cleanup Error:", cleanErr);
            });
        }
    });
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

// --- PUBLIC ROUTES (USER SIDE) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'landing.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'dashboard.html'));
});

app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'demo.html'));
});

app.get('/report-problem', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'report-problem.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'about.html'));
});

app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'contact.html'));
});

app.get('/features', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user', 'features.html'));
});

// --- ADMIN ROUTES (PROTECTED) ---
app.get('/login-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html')); 
});

app.get('/admin', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admindemo.html'));
});

app.get('/admin/reports', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'Report.html')); 
});

// ==========================================
// 6. API ROUTES
// ==========================================

app.post('/api/session-timeout', (req, res) => {
    if (req.session.username) {
        logActivity(req.session.username, 'SESSION_TIMEOUT', 'System auto-logout due to inactivity', req);
    }
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.post('/login', (req, res) => {
    const { adminId, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (loginAttempts[ip] && loginAttempts[ip].lockUntil > now) {
        const timeLeft = Math.ceil((loginAttempts[ip].lockUntil - now) / 1000);
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        
        logActivity(adminId || 'Unknown', 'LOGIN_BLOCKED', `Blocked login attempt`, req);

        return res.json({ 
            success: false, 
            message: `Account Locked. Too many failed attempts. Try again in ${minutes}m ${seconds}s.` 
        });
    }

    const sql = 'SELECT * FROM users WHERE username = ?';
    
    db.query(sql, [adminId], async (err, results) => {
        if (err) throw err;
        
        let loginSuccess = false;

        if (results.length > 0) {
            const user = results[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) loginSuccess = true;
        }

        if (loginSuccess) {
            if (loginAttempts[ip]) delete loginAttempts[ip]; 
            req.session.isLoggedIn = true;
            req.session.username = adminId;

            logActivity(adminId, 'LOGIN', 'Admin logged in successfully', req);

            res.json({ success: true });
        } else {
            logActivity(adminId || 'Unknown', 'LOGIN_FAILED', 'Failed login attempt', req); 

            if (!loginAttempts[ip]) {
                loginAttempts[ip] = { count: 0, lockUntil: null };
            }

            loginAttempts[ip].count++;

            if (loginAttempts[ip].count >= 3) {
                loginAttempts[ip].lockUntil = now + 300000; 
                return res.json({ 
                    success: false, 
                    message: "Too many failed attempts. You are BLOCKED for 5 minutes." 
                });
            }

            const remaining = 3 - loginAttempts[ip].count;
            res.status(401).json({ 
                success: false, 
                message: `Invalid Account. ${remaining} attempts remaining.` 
            });
        }
    });
});


// --- LOGOUT ROUTE ---
app.get('/logout', (req, res) => {
    // 1. Log the action (Optional but good for history)
    if (req.session.username) {
        logActivity(req.session.username, 'LOGOUT', 'Admin logged out', req);
    }
    
    // 2. Destroy the session
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout Error:", err);
            return res.redirect('/admin'); // If error, stay on admin page
        }
        // 3. Redirect to Login Page
        res.redirect('/login-page');
    });
});

app.get('/api/spots', (req, res) => {
    db.query('SELECT * FROM slots', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/logs', checkAuth, (req, res) => {
    db.query('SELECT * FROM activity_logs ORDER BY timestamp DESC', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/update-spot', (req, res) => {
    const { slot_id, status, plate_number, park_time, vehicle_type } = req.body;
    const currentUser = req.session.username || 'Unknown Admin'; 

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

        const checkSql = 'SELECT * FROM slots WHERE plate_number = ? AND status = "occupied" AND slot_number != ?';
        db.query(checkSql, [plate_number, slot_id], (err, results) => {
            if (err) return res.json({ success: false, message: "Database Error checking duplicates" });
            if (results.length > 0) return res.json({ success: false, message: `Error: Vehicle ${plate_number} is already parked at ${results[0].slot_number}!` });
            
            executeUpdate(currentUser);
        });

    } else {
        executeUpdate(currentUser);
    }

    function executeUpdate(user) {
        const sql = 'UPDATE slots SET status = ?, plate_number = ?, start_time = ?, vehicle_type = ? WHERE slot_number = ?';
        db.query(sql, [status, plate_number, park_time, vehicle_type, slot_id], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: "Database Update Failed" });
            
            const actionType = status === 'occupied' ? 'OCCUPY_SPOT' : 'RELEASE_SPOT';
            const details = status === 'occupied' 
                ? `Parked ${plate_number} (${vehicle_type}) at ${slot_id}`
                : `Released spot ${slot_id}`;
                
            logActivity(user, actionType, details, req);

            res.json({ success: true });
        });
    }
});

// ==========================================
// 7. REPORT SYSTEM ROUTES (WITH VALIDATION)
// ==========================================

// --- USER: SUBMIT A REPORT ---
app.post('/api/submit-report', (req, res) => {
    const { category, description, name, plate } = req.body;
    
    // 1. Check if fields are filled
    if (!category || !description || !name || !plate) {
        return res.json({ success: false, message: "All fields are required." });
    }

    // 2. VERIFY PLATE EXISTS IN DATABASE
    const checkPlateSql = 'SELECT * FROM slots WHERE plate_number = ? AND status = "occupied"';

    db.query(checkPlateSql, [plate], (err, results) => {
        if (err) {
            console.error("Database Error during verification:", err);
            return res.json({ success: false, message: "System Error verifying license plate." });
        }

        // If results array is empty, the car is NOT currently parked
        if (results.length === 0) {
            return res.json({ 
                success: false, 
                message: `Report Failed: Vehicle ${plate} is not currently parked in our facility.` 
            });
        }

        // 3. If Valid (Car exists), Proceed to Save
        const sql = 'INSERT INTO problem_reports (category, description, reporter_name, plate_number) VALUES (?, ?, ?, ?)';
        
        db.query(sql, [category, description, name, plate], (insertErr, result) => {
            if (insertErr) {
                console.error("Database Error saving report:", insertErr);
                return res.json({ success: false, message: "Database Error saving report." });
            }
            console.log(`New Report Received for ${plate}`);
            res.json({ success: true });
        });
    });
});

// --- ADMIN: DELETE A REPORT ---
app.delete('/api/admin/reports/:id', checkAuth, (req, res) => {
    const reportId = req.params.id;
    
    // Check if ID is valid
    if (!reportId) {
        return res.json({ success: false, message: "Invalid Report ID" });
    }

    const sql = 'DELETE FROM problem_reports WHERE id = ?';
    db.query(sql, [reportId], (err, result) => {
        if (err) {
            console.error("Delete Error:", err);
            return res.json({ success: false, message: "Database Error" });
        }
        
        // Log the action
        const user = req.session.username || 'Admin';
        logActivity(user, 'DELETE_REPORT', `Deleted report ID: ${reportId}`, req);
        
        res.json({ success: true });
    });
});

// --- ADMIN: GET ALL REPORTS ---
app.get('/api/admin/reports', checkAuth, (req, res) => {
    db.query('SELECT * FROM problem_reports ORDER BY report_date DESC', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// Helper for hashing (optional, for creating admin users)
app.post('/api/hash-password', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.json({ error: "No password provided" });
    const hash = await bcrypt.hash(password, 10);
    res.json({ original: password, hashed: hash });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});