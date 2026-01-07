import dotenv from 'dotenv';
dotenv.config();

type EnvShape = {
  INSTACART_CLIENT_ID?: string;
  INSTACART_CLIENT_SECRET?: string;
  INSTACART_OAUTH_URL?: string;
  INSTACART_IDP_BASE?: string;
  TOKEN_CACHE_SECONDS?: string | number;
  PORT?: string | number;
  ALLOWED_ORIGINS?: string[];
};

const ENV: EnvShape = {
  INSTACART_CLIENT_ID: process.env.INSTACART_CLIENT_ID,
  INSTACART_CLIENT_SECRET: process.env.INSTACART_CLIENT_SECRET,
  INSTACART_OAUTH_URL: process.env.INSTACART_OAUTH_URL,
  INSTACART_IDP_BASE: process.env.INSTACART_IDP_BASE,
  TOKEN_CACHE_SECONDS: process.env.TOKEN_CACHE_SECONDS,
  // default to 3000 if not set
  PORT: process.env.PORT ?? '3000',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : undefined,
};

export { ENV };
export default ENV;
module.exports = { ENV, default: ENV };