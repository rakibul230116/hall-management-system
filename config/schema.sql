-- ══════════════════════════════════════════
--  July-6 Hall Management System — PUST
--  Database Schema
-- ══════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS hall_management;
USE hall_management;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','student') DEFAULT 'student',
  student_id VARCHAR(20) UNIQUE,
  phone VARCHAR(20),
  department VARCHAR(100),
  session VARCHAR(20),
  gender ENUM('male','female') DEFAULT 'male',
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_number VARCHAR(20) UNIQUE NOT NULL,
  floor INT NOT NULL,
  capacity INT NOT NULL DEFAULT 4,
  occupied INT NOT NULL DEFAULT 0,
  type ENUM('single','double','quad') DEFAULT 'quad',
  status ENUM('available','full','maintenance') DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  room_id INT NOT NULL,
  seat_number INT NOT NULL,
  allocated_date DATE NOT NULL,
  vacated_date DATE,
  status ENUM('active','vacated') DEFAULT 'active',
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS notices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  posted_by INT NOT NULL,
  priority ENUM('normal','urgent') DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS complaints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category ENUM('water','electricity','food','maintenance','security','other') DEFAULT 'other',
  status ENUM('pending','in_progress','resolved') DEFAULT 'pending',
  admin_reply TEXT,
  replied_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meal_menus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_date DATE NOT NULL,
  meal_type ENUM('breakfast','lunch','dinner') NOT NULL,
  items TEXT NOT NULL,
  price DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY unique_menu (menu_date, meal_type)
);

CREATE TABLE IF NOT EXISTS meal_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  menu_id INT NOT NULL,
  token_code VARCHAR(30) UNIQUE NOT NULL,
  quantity INT DEFAULT 1,
  total_amount DECIMAL(8,2) NOT NULL,
  purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('active','used','cancelled') DEFAULT 'active',
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (menu_id) REFERENCES meal_menus(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  payment_type ENUM('hall_fee','dining','other') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  month VARCHAR(20),
  year INT,
  payment_method ENUM('cash','online','bkash') DEFAULT 'cash',
  transaction_id VARCHAR(100),
  status ENUM('paid','pending','failed') DEFAULT 'pending',
  payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS monthly_dues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  month VARCHAR(20) NOT NULL,
  year INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('paid','unpaid','waived') DEFAULT 'unpaid',
  paid_on TIMESTAMP NULL,
  UNIQUE KEY unique_due (student_id, month, year),
  FOREIGN KEY (student_id) REFERENCES users(id)
);

-- Default admin (password: admin123)
INSERT IGNORE INTO users (name, email, password, role)
VALUES ('Hall Admin', 'admin@july6hall.pust.ac.bd',
'$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWq', 'admin');
-- Password is: admin123

