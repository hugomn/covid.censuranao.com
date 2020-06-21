import axios from "axios";
import moment from "moment";
import { Source } from "generated/graphql";
import { query as q } from "faunadb";
import { serverClient } from "utils/fauna-auth";

const parseHealthMinister = async () => {
  const { data } = await axios.get(
    "https://xx9p7hp1p7.execute-api.us-east-1.amazonaws.com/prod/PortalGeralApi"
  );
  const { confirmados, obitos } = data;
  const date = new Date(data.dt_updated).toISOString().split("T")[0];
  const entry = {
    entryType: "COUNTRY",
    name: "Brasil",
    date: date,
    source: Source.HealthMinister,
    epiWeek: moment(date).week(),
    newCases: parseInt(confirmados.novos),
    totalCases: parseInt(confirmados.total),
    newDeaths: parseInt(obitos.novos),
    totalDeaths: parseInt(obitos.total),
  };
  return entry;
};

const parseBrasilIo = async () => {
  let results = [];
  let page =
    "https://brasil.io/api/dataset/covid19/caso_full/data?is_last=True&place_type=state";
  const { data } = await axios.get(page);
  results = results.concat(data.results);
  const date = results.reduce(
    (prev, current) =>
      !prev || new Date(prev).getTime() < new Date(current.date).getTime()
        ? current.date
        : prev,
    ""
  );
  const entry = {
    entryType: "COUNTRY",
    name: "Brasil",
    date: date,
    source: Source.Brasilio,
    epiWeek: moment(new Date(date)).week(),
    newCases: 0,
    totalCases: 0,
    newDeaths: 0,
    totalDeaths: 0,
  };

  results.forEach((row) => {
    if (entry.date === date) {
      entry.newCases += parseInt(row.new_confirmed);
      entry.newDeaths += parseInt(row.new_deaths);
      entry.totalCases += parseInt(row.last_available_confirmed);
      entry.totalDeaths += parseInt(row.last_available_deaths);
    }
  });
  return entry;
};

const checkEntryAndInsert = async (entry) => {
  try {
    await serverClient.query(
      q.Get(
        q.Match(q.Index("findAllDailyEntriesByDateAndSource"), [
          entry.entryType,
          entry.countr,
          entry.date,
          entry.source,
        ])
      )
    );
    return false;
  } catch (error) {
    await serverClient.query(
      q.Create(q.Collection("DailyEntry"), {
        data: entry,
      })
    );
    return true;
  }
};

const triggerDeploy = () => {
  axios.post(
    "https://api.zeit.co/v1/integrations/deploy/QmcxbXzxbUu8dP22WCs4nJtd1pLcetqZqhoKLtaVTEyMjt/h8HQqpH4Y7"
  );
};

export default async function signup(req, res) {
  try {
    console.log("key: ", process.env.FAUNADB_COVID_SECRET_KEY);
    const healthMinister = await parseHealthMinister();
    const brasilIo = await parseBrasilIo();
    const updated =
      (await checkEntryAndInsert(healthMinister)) ||
      (await checkEntryAndInsert(brasilIo));
    if (updated) {
      console.log("New entries found! Re-building app.");
      console.log("[HEATH_MINISTER]: ", healthMinister);
      console.log("[BRASILIO]: ", brasilIo);
      triggerDeploy();
    } else {
      console.log("No new entries found.");
    }
    res.status(200).send("Success!");
  } catch (error) {
    res.status(400).send(error.message);
  }
}