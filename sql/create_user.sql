-- Template only. Do NOT put your real password here (this file is committed).
-- Use scripts/create_db_user.sh instead: it reads MYSQL_PASSWORD from .env.
CREATE DATABASE IF NOT EXISTS idx_exchange CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'idx_user'@'localhost' IDENTIFIED BY 'change_me';
GRANT ALL PRIVILEGES ON idx_exchange.* TO 'idx_user'@'localhost';
FLUSH PRIVILEGES;
