import nodemailer from 'nodemailer';
import { validateOwnerEmail } from './runtime-config.mjs';

export function validateSmtp(value) {
  if (!value || typeof value.host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(value.host) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.secure !== 'boolean') throw new Error('Invalid SMTP configuration');
  const from = validateOwnerEmail(value.from);
  if ((value.user === undefined) !== (value.password === undefined) || (value.user !== undefined && (typeof value.user !== 'string' || !value.user.length || value.user.length > 512 || typeof value.password !== 'string' || !value.password.length || value.password.length > 4096))) throw new Error('Invalid SMTP authentication');
  return Object.freeze({host: value.host, port: value.port, secure: value.secure, from, ...(value.user === undefined ? {} : {user: value.user, password: value.password})});
}
export function createMailer(input) {
  const config = validateSmtp(input);
  const transport = nodemailer.createTransport({host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, tls: {rejectUnauthorized: true, minVersion: 'TLSv1.2'}, ...(config.user === undefined ? {} : {auth: {user: config.user, pass: config.password}}), pool: false, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true});
  return Object.freeze({
    async sendMagic({to, url}) { await transport.sendMail({from: {name: 'Shoof', address: config.from}, to: validateOwnerEmail(to), subject: 'Your Shoof sign-in link', text: `Open this link in the same browser where you requested it, then choose Continue. It expires in 10 minutes and can be used once.\n\n${url}\n\nIf you did not request this, ignore this email.`, disableFileAccess: true, disableUrlAccess: true}); },
    close: () => transport.close(),
  });
}
