# 🏛️ July-6 Hall Management System
**Pabna University of Science and Technology (PUST)**

---

## 🚀 Quick Setup

### 1. Install Requirements
- Node.js: https://nodejs.org (LTS)
- MySQL 8.0: https://dev.mysql.com/downloads/installer/

### 2. Configure .env
Edit `.env` with your MySQL password:
```
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=hall_management
```

### 3. Create Database
```bash
mysql -u root -p
```
Then inside MySQL:
```sql
SOURCE C:/path/to/hall-management-system/config/schema.sql;
```

### 4. Install & Run
```bash
npm install
node app.js
```
Visit: http://localhost:3000

---

## 🔐 Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@july6hall.pust.ac.bd | admin123 |
| Student | Register at /auth/register | — |

---

## 📁 Add Your Images

Place these in `public/images/`:
- `pust-logo.png` — PUST circular logo
- `hall-bg.jpg` — July-6 Hall exterior photo (used as background)
- `hall-building.jpg` — Hall building (used on homepage about section)

---

## ✅ All Features

| Feature | Details |
|---------|---------|
| 🏠 Home Page | Landing page with hall info, staff, facilities, location |
| 🔐 Auth | Login, Register, Logout |
| 📊 Admin Dashboard | Stats, quick actions, recent activity |
| 👥 Students | List, search, activate/deactivate |
| 🏠 Rooms | Add/delete rooms |
| 🔑 Seat Allocation | Allocate/vacate + **auto-generate monthly due** |
| 💰 Monthly Dues | Auto-generate, individual add, mark paid w/ bKash |
| 🍽️ Meal Menus | Breakfast / Lunch / Dinner menus |
| 🎟️ Meal Tokens | Buy tokens with **Cash or bKash** |
| 📢 Notices | Post notices with **image support** |
| 📝 Complaints | Water / Electricity / Food / Maintenance / Security / Other |
| 💳 Payments | Full payment records with bKash tracking |
| 📈 Reports | Revenue, dues, monthly breakdown |
| 👤 Student Profile | Edit name, phone, **change password** |
| 💰 Student Dues | View dues, **pay via bKash or cash** |
