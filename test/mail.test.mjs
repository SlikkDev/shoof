import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createMailer, validateSmtp } from '../src/mail.mjs';

test('SMTP configuration is explicit, bounded and strips unsafe transport overrides',()=>{
 const base={host:'smtp.example.invalid',port:587,secure:false,from:'signin@example.invalid'};
 assert.deepEqual(validateSmtp({...base,tls:{rejectUnauthorized:false},logger:true,ignoreTLS:true}),base);
 for(const change of [{host:'smtp://example.invalid'},{host:'x\r\nInjected:'},{port:0},{secure:'false'},{from:'Name <x@example.invalid>'},{user:'u'},{password:'p'}])assert.throws(()=>validateSmtp({...base,...change}));
});

test('SMTP without STARTTLS is refused before sending credentials or a magic link',async t=>{
 const commands=[];const server=createServer(socket=>{socket.setEncoding('utf8');socket.write('220 fictional SMTP\r\n');socket.on('data',data=>{commands.push(data);if(data.startsWith('EHLO'))socket.write('250-fictional\r\n250 AUTH PLAIN\r\n');else if(data.startsWith('STARTTLS'))socket.write('454 TLS unavailable\r\n');else socket.end();});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const mailer=createMailer({host:'127.0.0.1',port:server.address().port,secure:false,from:'signin@example.invalid',user:'fictional-user',password:'fictional-secret'});t.after(mailer.close);
 await assert.rejects(mailer.sendMagic({to:'owner@example.invalid',url:'https://report.example.invalid/login#token=fictional-link'}));
 const transcript=commands.join('');assert.equal(transcript.includes('AUTH'),false);assert.equal(transcript.includes('fictional-secret'),false);assert.equal(transcript.includes('MAIL FROM'),false);assert.equal(transcript.includes('fictional-link'),false);
});
