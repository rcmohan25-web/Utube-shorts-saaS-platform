import { Queue } from 'bullmq';

const queue = new Queue('publish', {
  connection: { host: '127.0.0.1', port: 6379 },
});

const scheduleId = 'cms4iwott001ritojxmktksr8';
const orgId = 'cmqqi28y00000jzpe9dkt63ee';

async function main() {
  const job = await queue.getJob(`publish_${scheduleId}`);
  console.log('existing job', job ? 'found' : 'missing');
  if (job) {
    console.log('state', await job.getState());
    await job.remove();
    console.log('removed');
  }
  const newJob = await queue.add(
    'publish',
    { scheduleId, organizationId: orgId },
    { jobId: `publish_${scheduleId}`, delay: 0, attempts: 5, backoff: { type: 'exponential', delay: 60000 } },
  );
  console.log('recreated job', newJob.id, 'state', await newJob.getState());
  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
