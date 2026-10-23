ALTER TABLE users ADD COLUMN login_name text;

ALTER TABLE users ADD CONSTRAINT users_login_name_format
  CHECK (login_name IS NULL OR (
    login_name = lower(btrim(login_name))
    AND char_length(login_name) BETWEEN 3 AND 32
    AND login_name ~ '^[a-z][a-z0-9_]{2,31}$'
  ));

CREATE UNIQUE INDEX users_login_name_unique ON users(login_name)
  WHERE login_name IS NOT NULL;
