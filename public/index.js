let transactions = [];
let myChart;

if (!checkForIndexedDb()) {
  console.log("There's no IndexDB support on your browser.");
  console.log("I guess you just better not have sketchy connectivity");
}

let db;

async function connectDatabase() {
  const localDb = idb.openDB('dbz', 1, {
    upgrade(db) {
      // Do I want a field of the transaction to be a key?
      // I think not because the only remotely appropriate field would be the
      // name and I don't like the idea of forcing uniqueness on that because
      // this is a user-entered field used for their reference and they may
      // not care for uniqueness semantics.  Why confuse them?  To them, it is 
      // just a concise label to describe the transaction and do we really want
      // to ding them for two seperate transactions named "vet bill"?
      db.createObjectStore('inflightTransactions', { autoIncrement: true });
    },
  });

  return localDb;
}

async function renderPageNoThrow() {
  try {
    if (!db) {
      db = await connectDatabase();
    }
    const response = await fetch("/api/transaction");
    const data = await response.json();

    // save db data on global variable
    transactions = data;

    populateTotal();
    populateTable();
    populateChart();

  }
  catch (ex) {
    console.log("Fetching blew up which is funny because you loaded this page", ex);
  };
}

function checkForIndexedDb() {
  window.indexedDB =
    window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

  window.IDBTransaction =
    window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
  window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

  if (!window.indexedDB) {
    console.log("Your browser doesn't support a stable version of IndexedDB.");
    return false;
  }
  return true;
}


// kicks it off all async and is responsible for never throwing
renderPageNoThrow();

async function updateOnlineStatus() {
  console.log("I'm back online!!!  Time to flood the server with pending inflight transactions!");

  const all = await db.getAll('inflightTransactions');

  console.log("all:", all);

  try {

    const response = await fetch("/api/transaction/bulk", {
      method: "POST",
      body: JSON.stringify(all),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json"
      }
    });

    // wipe the idb records so as to avoid double-committing any later
    db.clear('inflightTransactions');

  } catch (ex) {
    console.error("my post to update the database upon connection failed", ex);
  }
}

async function saveRecord(transaction) {
  // has name, value, date
  console.log("save transaction:", transaction);
  if (!window.indexedDB) {
    throw new Error("You're not getting offline transaction-buffering without indexedDB.  Sorry.");
  }

  if (!db) {
    throw new Error("I should have a successful db connection");
  }

  // no key.  The auto-increment is good.
  await db.add("inflightTransactions", transaction);
}
function populateTotal() {
  // reduce transaction amounts to a single total value
  let total = transactions.reduce((total, t) => {
    return total + parseInt(t.value);
  }, 0);

  let totalEl = document.querySelector("#total");
  totalEl.textContent = total;
}

function populateTable() {
  let tbody = document.querySelector("#tbody");
  tbody.innerHTML = "";

  transactions.forEach(transaction => {
    // create and populate a table row
    let tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${transaction.name}</td>
      <td>${transaction.value}</td>
    `;

    tbody.appendChild(tr);
  });
}

function populateChart() {
  // copy array and reverse it
  let reversed = transactions.slice().reverse();
  let sum = 0;

  // create date labels for chart
  let labels = reversed.map(t => {
    let date = new Date(t.date);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  });

  // create incremental values for chart
  let data = reversed.map(t => {
    sum += parseInt(t.value);
    return sum;
  });

  // remove old chart if it exists
  if (myChart) {
    myChart.destroy();
  }

  let ctx = document.getElementById("myChart").getContext("2d");

  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: "Total Over Time",
        fill: true,
        backgroundColor: "#6666ff",
        data
      }]
    }
  });
}

async function sendTransaction(isAdding) {
  let nameEl = document.querySelector("#t-name");
  let amountEl = document.querySelector("#t-amount");
  let errorEl = document.querySelector(".form .error");

  // validate form
  if (nameEl.value === "" || amountEl.value === "") {
    errorEl.textContent = "Missing Information";
    return;
  }
  else {
    errorEl.textContent = "";
  }

  // create record
  let transaction = {
    name: nameEl.value,
    value: amountEl.value,
    date: new Date().toISOString()
  };

  // if subtracting funds, convert amount to negative number
  if (!isAdding) {
    transaction.value *= -1;
  }

  // add to beginning of current array of data
  transactions.unshift(transaction);

  // re-run logic to populate ui with new record
  populateChart();
  populateTable();
  populateTotal();

  // also send to server
  try {
    const response = await fetch("/api/transaction", {
      method: "POST",
      body: JSON.stringify(transaction),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json"
      }
    })

    const data = await response.json();

    if (data.errors) {
      errorEl.textContent = "Missing Information";
    }
    else {
      // clear form
      nameEl.value = "";
      amountEl.value = "";
    }
  }
  catch (err) {
    // fetch failed, so save in the indexed db
    await saveRecord(transaction);

    // clear form
    nameEl.value = "";
    amountEl.value = "";
  }
}


document.querySelector("#add-btn").onclick = function () {
  sendTransaction(true);
};

document.querySelector("#sub-btn").onclick = function () {
  sendTransaction(false);
};

window.addEventListener('online', updateOnlineStatus);
