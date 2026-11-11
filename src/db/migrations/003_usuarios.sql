-- Migração 003: usuários do sistema (login por e-mail e senha) e e-mail opcional do cliente.

CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,            -- sempre em minúsculas
    senha_hash TEXT NOT NULL,                      -- bcrypt; a senha nunca é guardada
    perfil VARCHAR(20) NOT NULL DEFAULT 'atendente',   -- admin | atendente
    ativo BOOLEAN NOT NULL DEFAULT 1,
    -- Aumenta quando a senha muda ou o usuário é desativado: derruba os logins antigos na hora.
    token_versao INTEGER NOT NULL DEFAULT 1,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    ultimo_login DATETIME
);

ALTER TABLE clientes ADD COLUMN email VARCHAR(255);
