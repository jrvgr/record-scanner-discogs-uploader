"user strict";

import "dotenv/config";

import csv from "csv-parser";
import * as fs from "fs";
import inquirer from "inquirer";

const results = [];

if (!process.env.DISCOGS_TOKEN) {
  console.error("DISCOGS_TOKEN not set");
  process.exit(1);
}

if (!process.env.DISCOGS_USERNAME) {
  console.error("DISCOGS_USERNAME not set");
  process.exit(1);
}

if (!process.argv[2]) {
  console.error("No file provided");
  process.exit(1);
}

const promptSchema = {
  continue: {
    description: "Do you want to continue? (y/n)",
    pattern: /^[yn]$/i,
    message: "Please enter y or n",
    required: true,
  },
};

fs.createReadStream(process.argv[2])
  .pipe(csv())
  .on("data", (data) => results.push(data))
  .on("end", async () => {
    console.log("")
    results
      .sort((a, b) => a.Artist - b.Artist)
      .forEach((item) => {
        console.log([item.Title, item.DiscogsReleaseId]);
      });
    console.log(
      "\nData you're going to upload, do you want to continue?",
      process.env.DELETE_ALL_ITEMS_IN_COLLECTION
        ? "\nThis will remove all current items from discogs."
        : "\nThis will only add new items.",
      "\nuse the 'DELETE_ALL_ITEMS_IN_COLLECTION' env var to change this behavior (value of 1 or 0)",
    );
    // [
    //   { NAME: 'Daffy Duck', AGE: '24' },
    //   { NAME: 'Bugs Bunny', AGE: '22' }
    // ]
    //
  });

main();

async function main() {
  await inquirer
    .prompt([
      {
        type: "confirm",
        name: "confirmation",
        message: "Do you want to proceed?",
        default: false,
      },
    ])
    .then((answer) => {
      if (answer) {
        console.log("alright, let's go");
      } else {
        console.log("aborting");
        process.exit("1");
      }
    });

  const data = await getAllCurrentCollectionItems();
  if (process.env.DELETE_ALL_ITEMS_IN_COLLECTION === "1") {
    deleteAllItems(data.releases);
  }
  uploadRecords(results, data).finally(() => "Yippie!");
}

async function uploadRecord(record, attempt) {
  const response = await fetch(
    `https://api.discogs.com/users/${process.env.DISCOGS_USERNAME}/collection/folders/1/releases/${record.DiscogsReleaseId}`,
    {
      method: "POST",
      headers: {
        user_agent:
          "RecordCollectionUploader/1.0 +http://github.com/jrvgr/record-scanner-discogs-uploader",
        authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
        accept: "application/json",
      },
    },
  );

  if (response.status === 201) {
    console.log("uploaded: ", record.Title);
    return;
  }

  if (response.status === 429) {
    if (attempt > 10) {
      console.log(
        "alright, it's the ${attempt}th/rd/nd time i tried this, i give up",
      );
      return;
    }

    console.warn("rate limited, trying again in 1 minute |", record.Title);
    // wait for 20 seconds and try again
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    uploadRecord(record, attempt + 1);
  }
}

async function uploadRecords(records, data) {
  records.forEach(async (record) => {
    // if record is already in coolection and user doesn't want to delete
    // their records, skip

    if (
      data.releases &&
      data.releases
        .map((i) => i.id.toString())
        .includes(record.DiscogsReleaseId.toString()) &&
      [undefined, 0, "0", null].includes(
        process.env.DELETE_ALL_ITEMS_IN_COLLECTION,
      )
    ) {
      console.log(`skipping ${record.Title}, it is already uploaded`);
      return;
    }
    uploadRecord(record, 0);
  });
}

async function getAllCurrentCollectionItems() {
  const response = await fetch(
    `https://api.discogs.com/users/${process.env.DISCOGS_USERNAME}/collection/folders/1/releases?per_page=500`,
    {
      headers: {
        user_agent:
          "RecordCollectionUploader/1.0 +http://github.com/jrvgr/record-scanner-discogs-uploader",
        authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
        accept: "application/json",
      },
    },
  );

  const data = await response.json();
  // delete all items in collection if env variable is set

  if (!data.releases) return [];

  console.log("existing releases");
  data.releases
    .sort((a, b) => a.basic_information.title - b.basic_information.title)
    .forEach((item) => {
      console.log([
        item.basic_information.artists.map((a) => a.name).join(", ") +
          " - " +
          item.basic_information.title,
        item.id,
      ]);
    });
  return data;
}

function deleteAllItems(releases) {
  if (!releases) {
    console.log("no existing releases to delete");
    return;
  }
  releases.forEach(async (release) => {
    const deleteResponse = await fetch(
      `https://api.discogs.com/users/${process.env.DISCOGS_USERNAME}/collection/folders/1/releases/${release.id}/instances/${release.instance_id}`,
      {
        method: "DELETE",
        headers: {
          user_agent:
            "RecordCollectionUploader/1.0 +http://github.com/jrvgr/record-scanner-discogs-uploader",
          authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
          accept: "application/json",
        },
      },
    );

    if (deleteResponse.status === 204)
      console.log(
        "deleted: ",
        release.basic_information.artists.map((a) => a.name).join(", "),
        " - ",
        release.basic_information.title,
      );
  });
}
