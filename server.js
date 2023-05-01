const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const validator = require('validator');




const app = express();
const port = 3005;

app.use(express.json());
app.use(cors());


// initialize the database connection
const db = new sqlite3.Database('Bank.db', (err) => {
  if (err) {
    console.error(err.message);
  } else {
    console.log('Connected to the database.');
  }
});



const jwt = require('jsonwebtoken');

app.post('/login', (req, res) => {
  const { userInput, password, activeTab } = req.body;

  let isEmail;

  if (validator.isEmail(userInput)) {
    console.log('Input is an email address.');
    isEmail = true
  } else if (validator.isAlphanumeric(userInput)) {
    console.log('Input is a username.');
    isEmail = false
  } 

  query = isEmail ? `SELECT * FROM Users WHERE email_id = ? AND password = ?` : `SELECT * FROM Users WHERE username = ? AND password = ?`
  console.log('query',query);

  db.all(query, [userInput, password], (err, rows) => {
    if (err) {
      res.status(500).send('Internal server error');
    } else if (rows.length > 0) {
      if (activeTab === 'banker' && rows[0].stakeholder_type === 'customer') {
        res.status(402).send('Please Login Customer Section');
      } else if (activeTab === 'customer' && rows[0].stakeholder_type === 'banker') {
        res.status(403).send('Please Login Banker Section');
      } else if (activeTab === 'banker') {
        // if the user is a banker, retrieve all the rows of stakeholder type as customer
        db.all(`SELECT * FROM Users WHERE stakeholder_type = 'customer'`, [], (err, rows) => {
          if (err) {
            console.error(err.message);
            res.status(500).send('Internal server error');
          } else {
            // return the matched rows to the frontend
            const token = jwt.sign({ userInput,password }, 'npointeebankingapplication');
            res.json({ token, rows });
          }
        });
      } else if (activeTab === 'customer') {
        // retrieve account number of the customer
        db.get(query, [userInput,password], (err, row) => {
          if (err) {
            
            res.status(500).send('Internal server error');
          } else if (row) {
            // retrieve all the rows of the customer from the Accounts table using the account number
            db.get(`SELECT Account_holder_name, account_number, Account_balance FROM Users WHERE account_number = ?`, [row.account_number], (err, rows) => {
              if (err) {
                
                res.status(500).send('Internal server error 2');
              }
            else {
                // return the matched rows to the frontend
                
                const token = jwt.sign({ userInput,password }, 'npointeebankingapplication');
                res.json({ token, rows });
              }
            });
          } else {
            res.status(401).send('Invalid username or password');
          }
        });
      } else {
        const token = jwt.sign({ userInput,password }, 'npointeebankingapplication');
        res.json({ token, rows });
      }
    } else {
      res.status(401).send('Invalid username or password');
    }
  });
});




const authenticateToken = (request, response, next) => {
  let jwtToken;
  console.log('request',request)
  console.log('request headers',request.headers)
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
    console.log('jwtToken',jwtToken)
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, 'npointeebankingapplication', async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
};



const getRows = (query, params) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

app.post("/deposit",authenticateToken, async (req, res) => {
  const { depositTime,fromAccountNum,toAccountNum,depositAmount} = req.body;
  

  const fromAccountRows = await getRows(`SELECT * FROM Accounts WHERE Account_number = ?`, [fromAccountNum]);

  console.log('fromAccountRows',fromAccountRows)
  

  const toAccountRows = await getRows(`SELECT * FROM Accounts WHERE account_number = ?`, [toAccountNum]);


  if (fromAccountRows[fromAccountRows.length - 1].Remaining_balance < depositAmount){
    return res.status(400).json('Insufficient balance');
  }
  else if(toAccountRows === []){
   
    return res.status(400).json('To account does not exist');
  }
  else{
    const newBalance = parseInt(fromAccountRows[fromAccountRows.length - 1].Remaining_balance) - parseInt(depositAmount)   ;
    console.log('newBalance',newBalance)
    

    const afterDepositBalance = parseInt(toAccountRows[toAccountRows.length - 1].Remaining_balance) + parseInt(depositAmount);
    console.log('afterDepositBalance',afterDepositBalance)

    db.run(`INSERT INTO Accounts (Account_holder_name, account_number, credited_amount, credited_time, credited_by, debited_amount, debited_time, Remaining_balance)
        VALUES ('${fromAccountRows[0].Account_holder_name}', ${fromAccountNum}, '', '', '', ${depositAmount}, '${depositTime}', ${newBalance})`,
        function(err) {
          if (err) {
            console.error(err.message);
          } else {
            console.log('Rows inserted successfully!');
          }
      });


      // update the account_balance column for a user with account_number 4567890123
      db.run(`UPDATE Users SET account_balance = ? WHERE account_number = ?`, [newBalance, fromAccountNum], function(err) {
        if (err) {
          console.error(err.message);
        } else {
          console.log(`Rows updated: ${this.changes}`);
        }
      });


      db.run(`INSERT INTO Accounts (Account_holder_name, account_number, credited_amount, credited_time, credited_by, debited_amount, debited_time, Remaining_balance)
        VALUES ('${toAccountRows[0].Account_holder_name}', ${toAccountNum}, ${depositAmount}, '${depositTime}', '${fromAccountRows[0].Account_holder_name}', '', '', ${afterDepositBalance})`,
        function(err) {
          if (err) {
            return res.status(400).json(`${err.message}`);
          } else {
            return res.status(200).json(`Amount is deposited successfully from ${fromAccountRows[0].Account_holder_name} to ${toAccountRows[0].Account_holder_name}`);
          }
      });


      // update the account_balance column for a user with account_number 4567890123
      db.run(`UPDATE Users SET account_balance = ? WHERE account_number = ?`, [afterDepositBalance, toAccountNum], function(err) {
        if (err) {
          console.error(err.message);
        } else {
          console.log(`Rows updated: ${this.changes}`);
        }
      });
  }



});

app.post("/withdraw",authenticateToken, async (req, res) => {
  console.log("you are inside withdraw api")
  const { withdrawnTime,withdrawAmount,accountNumber} = req.body;

  const fromAccountRows = await getRows(`SELECT * FROM Accounts WHERE account_number = ?`, [accountNumber]);


  if (fromAccountRows[fromAccountRows.length - 1].Remaining_balance < withdrawAmount){
    return res.status(400).json('Insufficient balance');
  }
  else{
    const newBalance = fromAccountRows[fromAccountRows.length - 1].Remaining_balance  - withdrawAmount;   

      db.run(`INSERT INTO Accounts (Account_holder_name, Account_number, credited_amount, credited_time, credited_by, debited_amount, debited_time, Remaining_balance)
        VALUES ('${fromAccountRows[0].Account_holder_name}', ${fromAccountRows[0].Account_number}, '', '', '', ${withdrawAmount}, '${withdrawnTime}', ${newBalance})`,
        function(err) {
          if (err) {
            console.error(err.message);
          } else {
            res.send("Amount has been successfully debited from the account.");
          }
      });



      // update the account_balance column for a user with account_number 4567890123
      db.run(`UPDATE Users SET Account_balance = ? WHERE account_number = ?`, [newBalance, accountNumber], function(err) {
        if (err) {
          console.error(err.message);
        } else {
          console.log(`Rows updated: ${this.changes}`);
        }
      });
  }



});


app.post("/gettransactiondetails", authenticateToken,(req, res) => {

  const {customerAccountNumber} = req.body

  // query SQLite database for account information
  db.all(
    `SELECT credited_amount, credited_time, credited_by, debited_amount, debited_time,Remaining_balance 
     FROM Accounts 
     WHERE account_number = ?`,
    [customerAccountNumber],
    (err, rows) => {
      if (err) {
        res.status(500).send(err);
      } else {
        res.send(rows);
      }
    }
  );
});





// start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}.`);
});

const corsOptions = {
  origin: 'http://localhost:3005',
  optionsSuccessStatus: 200 
}

app.use('/api', cors(corsOptions));


app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self' data:;"); // Set CSP header
  next();
});
