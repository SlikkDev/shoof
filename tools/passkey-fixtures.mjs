// Synthetic authenticator for protocol tests only. Never a device or real account.
import { generateKeyPairSync, createHash, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
export function fakeAuthenticator() {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'P-256'}), jwk = publicKey.export({format:'jwk'}), idBytes = randomBytes(32), id = b64(idBytes);
  const cose = isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  return {
    id,
    registration(options, {origin='https://'+options.rp.id, rpID=options.rp.id, flags=0x45, fmt='none', challenge=options.challenge, crossOrigin=false}={}) {
      const client = Buffer.from(JSON.stringify({type:'webauthn.create',challenge,origin,crossOrigin}));
      const length = Buffer.alloc(2);length.writeUInt16BE(idBytes.length);
      const authData=Buffer.concat([hash(rpID),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),length,idBytes,cose]);
      const attestation=isoCBOR.encode(new Map([['fmt',fmt],['attStmt',new Map()],['authData',authData]]));
      return {id,rawId:id,type:'public-key',response:{clientDataJSON:b64(client),attestationObject:b64(attestation),transports:['internal']},clientExtensionResults:{credProps:{rk:true}}};
    },
    authentication(options, userId, {origin='https://'+options.rpId,rpID=options.rpId,flags=0x05,counter=1,challenge=options.challenge,crossOrigin=false}={}) {
      const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin})), count=Buffer.alloc(4);count.writeUInt32BE(counter);
      const authData=Buffer.concat([hash(rpID),Buffer.from([flags]),count]);
      const signature=sign('sha256',Buffer.concat([authData,hash(client)]),privateKey);
      return {id,rawId:id,type:'public-key',response:{clientDataJSON:b64(client),authenticatorData:b64(authData),signature:b64(signature),userHandle:userId},clientExtensionResults:{}};
    },
  };
}
