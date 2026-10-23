import { storeCredential } from "../../../packages/ulm/src/credentials.ts"
await storeCredential({ credentialsDir: process.argv[2]!, operationRoot: process.argv[3]!, operationID: "race-operation", value: { username: crypto.randomUUID(), password: crypto.randomUUID() } })
