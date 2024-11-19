import EventEmitter from "node:events";
import * as fs from "node:fs";

import fastify from "fastify";
import { PassThrough } from "node:stream";

const app = fastify();

type Task = {
  emitter: EventEmitter;
  totalCount: number;
  state: 1 | 2 | 3;
};
const tasks: Record<string, Readonly<Task>> = {};

async function testStream(taskName: string) {
  const totalCount = 100;
  async function* getData() {
    const data = Array(totalCount)
      .fill(0)
      .map((_, idx) => idx);
    for (const item of data) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      yield item;
    }
  }

  const emitter = new EventEmitter();
  const data: Task = {
    emitter,
    totalCount: 0,
    state: 1,
  };
  tasks[taskName] = data;

  await new Promise((resolve) => setTimeout(resolve, 1000));

  data.totalCount = totalCount;
  emitter.emit("total_count", totalCount);

  for await (const data of getData()) {
    console.log("Data:", data);
    emitter.emit("progress", data);
  }

  console.log("DONE!");
  data.state = 2;
  emitter.emit("done");
  // TODO: Delete immediately or after some time to
  // prevent running the same task to frequently
  delete tasks[taskName];
}

function setupEmitter(opName: string) {
  if (!tasks[opName]) {
    testStream(opName);
  }
  return tasks[opName];
}

app.get("/", async (_req, resp) => {
  const index = fs.createReadStream("./public/index.html");
  return resp.send(index);
});

app.get("/test-stream", async (_req, reply) => {
  console.log("Existing streams:", tasks);
  const opName = "foo"; // we can make this from something like sha256_b64([arg1, arg2, ...].join())
  const task = setupEmitter(opName);
  console.log("Task:", task);

  reply.header("transfer-encoding", "chunked");
  reply.header("content-type", "application/jsonl+json");

  const stream = new PassThrough({ highWaterMark: 128 });
  reply.send(stream);

  function onTotalCount(totalCount: number) {
    stream.write(`{"totalCount":${totalCount}}\n`);
  }
  function onProgress(progress: number) {
    stream.write(`{"progress":${progress}}\n`);
  }
  function onState(state: number) {
    stream.write(`{"state":${state}}\n`);
  }
  function onDone() {
    stream.end(`{"done":true}\n`);
  }

  stream.write(`{"state":${task.state}}\n`);
  if (task.totalCount) {
    stream.write(`{"totalCount":${task.totalCount}}\n`);
  }

  task.emitter.on("total_count", onTotalCount);
  task.emitter.on("progress", onProgress);
  task.emitter.on("state", onState);
  task.emitter.on("done", onDone);
  reply.raw.on("close", () => {
    // Make sure we don't leak event listeners if the requester closes the stream.
    task.emitter.off("total_count", onTotalCount);
    task.emitter.off("progress", onProgress);
    task.emitter.off("state", onState);
    task.emitter.off("done", onDone);
    stream.end();
  });

  return reply;
});

app.listen({ port: 6969, }, err => {
  if (err) {
    console.log("Error:", err);
    process.exit(1);
  }
  console.info("Listening on port 6969");
});
