import { createECDH } from "node:crypto";

const keyPair = createECDH("prime256v1");
keyPair.generateKeys();

console.log(JSON.stringify({
  VAPID_PUBLIC_KEY: keyPair.getPublicKey().toString("base64url"),
  VAPID_PRIVATE_KEY: keyPair.getPrivateKey().toString("base64url"),
}, null, 2));