#!/usr/bin/env node
/* Prints a fresh VAPID key pair for Web Push. Put the PUBLIC key in online.js (VAPID_PUBLIC_KEY) and set the
 * PRIVATE key as a Supabase secret: supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:you@yourdomain
 * Never commit the private key. Usage: node tools/vapid-keys.js */
'use strict';
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64u = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64'), Buffer.from(pub.y, 'base64')]);
console.log('VAPID_PUBLIC_KEY=' + b64u(raw.toString('base64')));
console.log('VAPID_PRIVATE_KEY=' + b64u(Buffer.from(priv.d, 'base64').toString('base64')));
