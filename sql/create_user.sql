-- Run once as root:  mysql -u root -p < sql/create_user.sql
CREATE DATABASE IF NOT EXISTS idx_exchange CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'idx_user'@'localhost' IDENTIFIED BY 'IdxIntern2026!';
GRANT ALL PRIVILEGES ON idx_exchange.* TO 'idx_user'@'localhost';
FLUSH PRIVILEGES;
