import 'dotenv/config';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { getOAuth2Client } from './lib/google-auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

// Test scenarios - different deal types, stages, urgency
const scenarios = [
  {
    alias: 'novak.jan',
    name: 'Jan Novák',
    subject: 'RE: Vinohradská 12 - smlouva',
    body: `Dobrý den,

děkuji za trpělivost s těmi úpravami smlouvy. Po konzultaci s manželkou jsme se rozhodli - souhlasíme s provizí 3.5%.

Můžeme to podepsat tento týden? Ideálně úterý nebo středa dopoledne u vás v kanceláři.

S pozdravem,
Jan Novák
Tel: 602 123 456`,
    // seller, closing, urgent
  },
  {
    alias: 'svobodova.marie',
    name: 'Marie Svobodová',
    subject: 'Dotaz na cenu bytu - Žižkov',
    body: `Dobrý den,

stále čekám na tu cenovou nabídku pro můj byt na Žižkově, o které jsme mluvili minulý týden. 

Potřebuji to vědět do pátku, protože mám ještě nabídku od jiné realitky.

Děkuji,
Marie Svobodová`,
    // seller, negotiating, deadline
  },
  {
    alias: 'horak.petr',
    name: 'Petr Horák',
    subject: 'Hledám byt 3+kk Karlín',
    body: `Dobrý den,

dostal jsem váš kontakt od kolegy. Hledám s přítelkyní byt 3+kk v Karlíně nebo okolí, budget do 8 milionů.

Máte něco volného? Mohli bychom se sejít tento týden?

Děkuji,
Petr Horák
horak.petr@email.cz`,
    // buyer, lead, new
  },
  {
    alias: 'marek.tomas',
    name: 'Tomáš Marek',
    subject: 'RE: Prodej domu Říčany',
    body: `Dobrý den,

omlouvám se za dlouhé mlčení. Měli jsme rodinné záležitosti.

Stále máme zájem prodat, ale potřebujeme ještě probrat tu cenu. Ten váš odhad 12 milionů mi přijde nízký, soused prodal podobný dům za 14.

Můžeme to probrat?

Tomáš Marek`,
    // seller, negotiating, was cold
  },
  {
    alias: 'dvorakova.eva',
    name: 'Eva Dvořáková',
    subject: 'Prohlídka bytu Vinohrady - potvrzení',
    body: `Dobrý den,

potvrzuji prohlídku bytu na Vinohradech v pátek ve 14:00.

Přijdu s manželem. Máme předschválený hypoteční úvěr, takže pokud se nám byt bude líbit, můžeme jednat rychle.

S pozdravem,
Eva Dvořáková`,
    // buyer, negotiating, meeting scheduled
  },
  {
    alias: 'kral.martin',
    name: 'Martin Král',
    subject: 'Urgentní - kupec na Dejvice',
    body: `Ahoj,

mám klienta co hledá přesně ten byt co máš v Dejvicích. 4+kk, má cash, chce koupit tento měsíc.

Zavolej mi ASAP.

Martin
Král Reality`,
    // buyer referral, closing, very urgent
  },
];

async function sendTestEmail(gmail, fromAlias, fromName, toEmail, subject, body) {
  // Create "From" header with alias
  const fromEmail = `pod.one+${fromAlias}@gmail.com`;
  const fromHeader = `${fromName} <${fromEmail}>`;
  
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = `=?UTF-8?B?${utf8Subject}?=`;

  const messageParts = [
    `From: ${fromHeader}`,
    `To: ${toEmail}`,
    `Subject: ${encodedSubject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\n');

  const encodedMessage = Buffer.from(messageParts)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage }
  });

  return res.data.id;
}

async function main() {
  console.log('--- SENDING TEST EMAILS ---\n');

  // Get user OAuth
  const { data: users } = await supabase.from('users').select('*').limit(1);
  if (!users?.length) {
    console.error('No user found');
    return;
  }
  const user = users[0];

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(user.google_oauth_tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Send each scenario
  for (const s of scenarios) {
    try {
      const msgId = await sendTestEmail(
        gmail,
        s.alias,
        s.name,
        user.email,
        s.subject,
        s.body
      );
      console.log(`✓ Sent: ${s.name} - "${s.subject}"`);
    } catch (err) {
      console.error(`✗ Failed: ${s.name} - ${err.message}`);
    }
  }

  console.log('\n--- DONE ---');
  console.log('Now run: node backfill.js');
}

main();
