import "dotenv/config";
import { postgres } from "../src/core/database.js";
if(!process.env.WEB_MIGRATION_DATABASE_URL)throw Error("Configure the gateway's separate migration database credential");
const db=postgres(process.env.WEB_MIGRATION_DATABASE_URL);
try{await db.migrate("commerce");}finally{await db.close();}
