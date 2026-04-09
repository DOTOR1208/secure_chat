-- E2EE Messaging — MySQL schema (Waterfall spec)
-- IDs: CHAR(36) UUID v4 (application-generated) to mitigate IDOR enumeration.
-- Charset: utf8mb4 for full Unicode support (usernames, future metadata).

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `Messages`;
DROP TABLE IF EXISTS `Participants`;
DROP TABLE IF EXISTS `Conversations`;
DROP TABLE IF EXISTS `PreKeys`;
DROP TABLE IF EXISTS `Users`;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `Users` (
    `user_id` CHAR(36) NOT NULL COMMENT 'UUID v4',
    `username` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `identity_pubkey` TEXT NOT NULL COMMENT 'PEM/base64 public key material for identity (server stores only public material)',
    PRIMARY KEY (`user_id`),
    UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `PreKeys` (
    `key_id` CHAR(36) NOT NULL COMMENT 'UUID v4',
    `user_id` CHAR(36) NOT NULL,
    `pubkey` TEXT NOT NULL,
    `is_used` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Boolean: 0 false, 1 true',
    PRIMARY KEY (`key_id`),
    KEY `idx_prekeys_user_id` (`user_id`),
    CONSTRAINT `fk_prekeys_user` FOREIGN KEY (`user_id`) REFERENCES `Users` (`user_id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Conversations` (
    `conv_id` CHAR(36) NOT NULL COMMENT 'UUID v4',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`conv_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Participants` (
    `user_id` CHAR(36) NOT NULL,
    `conv_id` CHAR(36) NOT NULL,
    `role` VARCHAR(64) NOT NULL DEFAULT 'member',
    `join_date` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `conv_id`),
    KEY `idx_participants_conv_id` (`conv_id`),
    CONSTRAINT `fk_participants_user` FOREIGN KEY (`user_id`) REFERENCES `Users` (`user_id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_participants_conv` FOREIGN KEY (`conv_id`) REFERENCES `Conversations` (`conv_id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Messages` (
    `m_id` CHAR(36) NOT NULL COMMENT 'UUID v4',
    `conv_id` CHAR(36) NOT NULL,
    `sender_id` CHAR(36) NOT NULL,
    `timestamp` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `message_index` INT NOT NULL COMMENT 'Sequence / AES-GCM nonce input per protocol',
    `ciphertext` LONGTEXT NOT NULL COMMENT 'Opaque ciphertext; server is blind relay',
    PRIMARY KEY (`m_id`),
    KEY `idx_messages_conv_time` (`conv_id`, `timestamp`),
    KEY `idx_messages_sender` (`sender_id`),
    UNIQUE KEY `uq_messages_conv_message_index` (`conv_id`, `message_index`),
    CONSTRAINT `fk_messages_conv` FOREIGN KEY (`conv_id`) REFERENCES `Conversations` (`conv_id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_messages_sender` FOREIGN KEY (`sender_id`) REFERENCES `Users` (`user_id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
