-- Distingue un refresh token rotado (reemplazado por otro) de uno revocado (logout, robo).
-- Permite un margen corto para pestañas que renuevan a la vez con el mismo token.
ALTER TABLE refresh_tokens ADD COLUMN rotated_at TEXT;
