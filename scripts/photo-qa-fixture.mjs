import { hashPassword } from '../worker/security.js';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const db = '96ae85a7-61f5-493e-847b-51a17aa39465';
const control = 'f321a737-e02b-490a-a5b0-61da0551b7c6';
async function query(database, sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await r.json();
  if (!data.success || data.result?.[0]?.success === false) throw new Error(JSON.stringify(data.errors));
  return data.result[0];
}
if (process.argv[2] === 'create') {
  const name = `QA Photo Upload ${Date.now()}`;
  const username = `qa-photo-${crypto.randomUUID().slice(0,8)}`;
  const password = crypto.randomUUID();
  const { hash, salt } = await hashPassword(password);
  const company = (await query(control, "SELECT id FROM clients WHERE database_kind = 'native' AND status = 'active'")).results[0];
  if (!company) throw new Error('No native test target');
  const buildingId = (await query(db, "INSERT INTO buildings(name, status, client_id) VALUES (?, 'active', 1)", [name])).meta.last_row_id;
  const userId = (await query(db, "INSERT INTO users(username,password_hash,password_salt,full_name,job_title,role,building_id,client_id,classification,status) VALUES (?,?,?,?,?,'superintendent',?,1,'beta_tester','active')", [username,hash,salt,'Photo QA Tester','QA',buildingId])).meta.last_row_id;
  await query(control, 'INSERT INTO login_directory(email,client_id) VALUES (?,?)', [username,company.id]);
  const groupId = (await query(db, "INSERT INTO equipment_groups(building_id,name) VALUES (?, 'QA Machine')", [buildingId])).meta.last_row_id;
  const tagId = (await query(db, "INSERT INTO inspection_tags(building_id,system_name,tag_no,reading_type,unit,equipment_group_id) VALUES (?,'QA','QA-1','Pressure','PSI',?)", [buildingId,groupId])).meta.last_row_id;
  console.log(JSON.stringify({name,username,password,buildingId,userId,groupId,tagId}));
} else if (process.argv[2] === 'inspect') {
  const buildingId = Number(process.argv[3]);
  const rows = await query(db, "SELECT backend, location, context FROM photos WHERE building_id=?", [buildingId]);
  console.log(JSON.stringify(rows.results));
} else if (process.argv[2] === 'metadata') {
  const rows = await query(db, 'SELECT gp.captured_at,gp.latitude,gp.longitude FROM group_photos gp JOIN equipment_groups eg ON eg.id=gp.equipment_group_id WHERE eg.building_id=?', [Number(process.argv[3])]);
  console.log(JSON.stringify(rows.results));
} else if (process.argv[2] === 'disable') {
  const buildingId = Number(process.argv[3]);
  const b = (await query(db, 'SELECT name FROM buildings WHERE id=?', [buildingId])).results[0];
  if (!b?.name.startsWith('QA Photo Upload ')) throw new Error('Refusing non-QA target');
  await query(db, 'UPDATE users SET is_active=0,removed_at=CURRENT_TIMESTAMP WHERE building_id=?', [buildingId]);
  await query(db, 'UPDATE buildings SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', [buildingId]);
  console.log('QA fixture archived; evidence retained.');
}
