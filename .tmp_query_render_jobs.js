const { MongoClient } = require('mongodb');
(async ()=>{
  try {
    const uri = 'mongodb+srv://autocapsmain:love@cluster0.eobs2so.mongodb.net/?appName=Cluster0'
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db('Cluster0')
    const jobs = await db.collection('render_jobs').find({ uploadId: '693912001d06333e8e794af3' }).sort({_id:-1}).limit(10).toArray()
    console.log('=== render_jobs ===')
    console.log(JSON.stringify(jobs, null, 2))
    const uploads = await db.collection('uploads').find({ _id: { $exists: true } }).sort({_id:-1}).limit(5).toArray()
    console.log('=== uploads sample ===')
    console.log(JSON.stringify(uploads, null, 2))
    await client.close()
  } catch (e) {
    console.error('ERROR', e)
    process.exit(1)
  }
})()
