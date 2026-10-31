export const config = {
  port: Number(process.env.PORT || 18180),
  jwtSecret: process.env.JWT_SECRET || 'yunsuo-dev-secret-change-me',
  cookieSecret: process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'yunsuo-dev-cookie-key-change-me',
  admin: {
    username: String(process.env.ADMIN_USERNAME || 'admin').trim(),
    password: String(process.env.ADMIN_PASSWORD || '')
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'mysql',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'yunsuo',
    password: process.env.MYSQL_PASSWORD || 'yunsuo',
    database: process.env.MYSQL_DATABASE || 'yunsuo'
  }
}
