const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const DBClient = require('./models/DBClient');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const secret = process.env.JWT_SECRET;
const genSalt = bcrypt.genSalt(10);
const PORT = process.env.PORT || 4000;

// middleware
app.use(express.json())
app.use(cookieParser())

// show transaction history
app.get('/history', async(req, res) => {
    const client = DBClient();    
    try {
        const { token } = req.cookies;
        if(token) {
            jwt.verify( token, secret, { }, async(err, info) => {
                if(err) throw err
                if(info) {
                    const { userId } = info;
                    await client.connect();
                    let dbName = 'yahvipay'
                    const db = client.db(dbName);
                    let transactionsCollectionName = 'usersTransactions';
                    const transactionsCollection = db.collection(transactionsCollectionName);
                    const result = await transactionsCollection.aggregate([
                        {
                            $match : {
                                $or : [
                                    { sender : userId },
                                    { receiver : userId }
                                ]
                            }
                        },
                        { $sort: { createdAt: -1 } }
                    ]).toArray();
                    if(result.length) {
                        await client.close();
                        return res.status(200).json(result);
                    }
                    else {
                        await client.close();
                        return res.status(400).json('no history');
                    }
                }
                else {
                    return res.status(400).json('unauthorized user');
                }
            })
        }
        else { 
            return res.status(400).json('unauthorized user');
        }
    }
    catch(e) {
        await client.close();
        return res.status(400).json('error');
    }
})

// transfer money to bank using bank details
app.post('/bank-transfer', async(req, res) => {
    const client = DBClient();
    try {
        const { token } = req.cookies;
        const { bankAccountNumber, ifscCode, paymentAmount } = req.body;
        if(token) {
            jwt.verify( token, secret, { }, async(err, info) => {                
                if(err) throw err                
                if(info) {
                    const { userId } = info;
                    await client.connect();
                    let dbName = 'yahvipay'
                    const db = client.db(dbName);
                    // login users collection
                    let loginUsersCollectionName = 'loginUsers';
                    const loginUserCollection = db.collection(loginUsersCollectionName);
                    const loginUserBalance = await loginUserCollection.findOne({ userId : userId }, {
                        projection : {
                            _id : 0,
                            accountBalace : 1                             
                        }
                    })
                    // checking account balance
                    if(loginUserBalance.accountBalace >= Number(paymentAmount)) {
                        // reduce account balance from sender account
                        const updateBalance = await loginUserCollection.updateOne({ userId : userId }, { $inc : { accountBalace : -paymentAmount }});
                        let transactionId = `transactionId${Date.now()}`
                        const createdDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
                        let transactionsCollectionName = 'usersTransactions';
                        const transactionsCollection = db.collection(transactionsCollectionName);
                        // creating new transaction 
                        const result = await transactionsCollection.insertOne({
                            transactionId : transactionId,
                            paymentAmount : paymentAmount,
                            paymentStatus : 'paid',
                            sender : userId,
                            receiver : bankAccountNumber,
                            createdAt : createdDate
                        })  
                        if(result.acknowledged) {    
                            await client.close();
                            return res.status(200).json(result);
                        }
                        else {
                            await client.close();    
                            return res.status(400).json('no history');
                        }
                    } 
                    else {
                        await client.close();
                        return res.status(400).json('Insufficient balance')
                    }
                }
                else {
                    return res.status(400).json('unauthorized user');
                }
            })
        }
        else { 
            return res.status(400).json('unauthorized user');        
        }
    }
    catch {
        await client.close();
        return res.status(400).json('Error')
    }
})


// making payment using upi-id
app.post('/pay-upi-id', async(req, res) => {
    const client = DBClient();
    try {        
        const { token } = req.cookies;
        const { upiId, paymentAmount } = req.body;
        if(token) {
            jwt.verify( token, secret, { }, async(err, info) => {                
                if(err) throw err                
                if(info) {
                    const { userId } = info;
                    await client.connect();
                    let dbName = 'yahvipay'
                    const db = client.db(dbName);
                    // login users collection
                    let loginUsersCollectionName = 'loginUsers';
                    const loginUserCollection = db.collection(loginUsersCollectionName);
                    const loginUserUpiId = await loginUserCollection.findOne({ upiId : upiId }, {
                        projection : {
                            _id : 0,
                            upiId : 1,
                            userId : 1,
                            accountBalace : 1
                        }
                    })
                    // checking user is paying to the own upi id
                    if(loginUserUpiId.userId !== userId) {
                        // checking account balance
                        if(loginUserCollection.accountBalace >= Number(paymentAmount)) {
                            // reduce account balance from sender
                            const updateBalance = await loginUserCollection.updateOne({ userId : userId }, { $inc : { accountBalace : -Number(paymentAmount) }})
                            // adding account balance to receiver
                            const updateUPIIdBalance = await loginUserCollection.findOneAndUpdate({ upiId : upiId }, { $inc : { accountBalace : + Number(paymentAmount)} })

                            let transactionId = `transactionId${Date.now()}`
                            const createdDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
                            let transactionsCollectionName = 'usersTransactions';
                            const transactionsCollection = db.collection(transactionsCollectionName);
                            // creating new transaction
                            const result = await transactionsCollection.insertOne({
                                transactionId : transactionId,
                                sender : userId,
                                receiver : upiId,
                                paymentAmount : Number(paymentAmount),
                                paymentStatus : 'paid',
                                createdAt : createdDate
                            })        
                            if(result.acknowledged) {
                                await client.close();
                                return res.status(200).json('successfully transfer');
                            }
                            else {
                                await client.close();
                                return res.status(400).json('transfer pending');
                            }                            
                        }
                        else {
                            await client.close();
                            return res.status(400).json('Insufficient balance')
                        }
                    }
                    else {
                        await client.close();
                        return res.status(400).json('can not pay your own upi id');
                    }
                }
                else {
                    return res.status(400).json('unauthorized user');
                }
            })
        }
        else { 
            return res.status(400).json('unauthorized user');
        }
    }
    catch {
        await client.close();
        return res.status(400).json('Error');
    }
})
// make payment to person to person using phone number
app.post('/make-payment', async(req, res) => {
    const client = client();
    try {        
        const { token } = req.cookies;
        const { phoneNo, paymentAmount } = req.body;
        if(token) {
            jwt.verify( token, secret, { }, async(err, info) => {                
                if(err) throw err                
                if(info) {
                    const { userId } = info;
                    await client.connect();
                    let dbName = 'yahvipay'
                    const db = client.db(dbName);
                    // login user collection
                    let loginUsersCollectionName = 'loginUsers';
                    const loginUserCollection = db.collection(loginUsersCollectionName);
                    const findUser = await loginUserCollection.findOne({ phoneNo : phoneNo }, {
                        projection : {
                            _id : 0,
                            upiId : 1,
                            userId : 1
                        }
                    })
                    // checking user is not to same
                    if(findUser && findUser.userId !== userId) {
                        // reduce account balance from sender
                        const UserAccount = await loginUserCollection.updateOne({ userId : userId, accountBalace : { $gte : Number(paymentAmount) } }, {
                            $inc : { accountBalace : -Number(paymentAmount) }
                        })
                        if(UserAccount.acknowledged) {
                            // adding account balance to receiver
                            const addAmount = await loginUserCollection.updateOne({ userId : findUser.userId }, { $inc : { accountBalace : +Number(paymentAmount) }})
                            let transactionId = `transactionId${Date.now()}`
                            const createdDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
                            let transactionsCollectionName = 'usersTransactions';
                            const transactionsCollection = db.collection(transactionsCollectionName);
                            // creating new transaction
                            const result = await transactionsCollection.insertOne({
                                transactionId : transactionId,
                                sender : userId,
                                receiver : findUser.userId,
                                paymentAmount : Number(paymentAmount),
                                paymentStatus : 'paid',
                                createdAt : createdDate
                            })
                            if(result.acknowledged) {
                                await client.close();
                                return res.status(200).json('successfully transfer');
                            }
                            else {
                                await client.client()
                                return res.status(400).json('transfer pending');
                            }
                        }
                        else {
                            await client.close();
                            return res.status(400).json('Insufficient balance')
                        }
                    } 
                    else {
                        await client.close();
                        return res.status(400).json('can not pay your own account')
                    }
                }
                else {
                    return res.status(400).json('unauthorized user');
                }
            })
        }
        else { 
            return res.status(400).json('unauthorized user');
        }
    }
    catch {
        await client.close();
        return res.status(400).json('Error');
    }
})

// creating new user
app.post('/create-user', async(req, res) => {
    const client = DBClient();
    try {        
        const { phoneNo, passwordPin, fullName, email, bankName, bankAccountNumber, ifscCode, aadharNumber, panCard } = req.body;
        // checking phone number 
        if(!isNaN(Number(phoneNo))) return res.status(400).json('Invalid phone number') 
        // checking account number
        if(!isNaN(Number(bankAccountNumber))) return res.status(400).json('Invalid Bank Account Number') 
        // phone number should be length 10
        if(Number(phoneNo).toString().length !== 10) return res.status(400).json('Invalid phone number')
        // password pin should be length 6
        if(Number(passwordPin).toString().length !== 6) return res.status(400).json('Password Pin should be 6')
        // checking all the input details is given
        if(!fullName && !email && !bankName && !bankAccountNumber && !ifscCode && !Number(aadharNumber) && !panCard) {
            return res.status(400).json('details required')
        }
        await client.connect();
        let userId = `userId${Date.now()}`
        let upiId = `${phoneNo}@yahvipay`
        const createdDate = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        let dbName = 'yahvipay'
        const db = client.db(dbName);
        // login users collection
        let loginUsersCollectionName = 'loginUsers';
        const loginUserCollection = db.collection(loginUsersCollectionName);
        const result = loginUserCollection.insertOne({
            userId : userId,
            upiId : upiId,
            fullName : fullName,
            email : email,
            bankName : bankName,
            bankAccountNumber : bankAccountNumber,
            ifscCode : ifscCode,
            phoneNo : phoneNo,
            aadharNumber : aadharNumber,
            panCard : panCard,
            createdAt : createdDate
        })
        if(result.acknowledged) {
            await client.close();
            return res.status(200).json('successfully created');
        }
        else {
            await client.close();
            return res.status(400).json('problem with create user');
        }
    }
    catch {
        await client.close();
        return res.status(400).json('Error');
    }
})
// user login
app.post('/login-user', async(req, res) => {
    const client = DBClient();
    try {        
        const { phoneNo, passwordPin } = req.body;
        // checking valid input or not
        if(Number(phoneNo).toString().length !== 10) return res.status(400).json('Invalid phone number')
        if(Number(phoneNo).toString().length !== 6) return res.status(400).json('Invalid password pin')
        // connecting db
        await client.connect();
        let dbName = 'yahvipay'
        const db = client.db(dbName);
        let loginUsersCollectionName = 'loginUsers';
        const loginUserCollection = db.collection(loginUsersCollectionName);
        const result = loginUserCollection.findOne({ phoneNo : phoneNo })
        if(result.acknowledged) {
            let hashPassword = bcrypt.compareSync(passwordPin, result.password);
            if(hashPassword) {
                await client.close();
                let userId = result.userId;                        
                // creating token payload with userName userId and fullname 
                jwt.sign({ userName, userId, fullname }, secret, { expiresIn : '1d' }, (err,token) => {
                    if(err) throw err
                    return res.cookie('token', token, { httpOnly: true, sameSite: 'None', secure : 'true' })
                    .json({ userName }).status(200);
                })
            }
            else {
                await client.close();
                return res.status(400).json('User not authenticate');
            }
        }
        else {
            await client.close();
            return res.status(400).json('User is not exists.');
        }
    }
    catch {
        await client.close();
        return res.status(400).json('Error');
    }
})

app.listen(PORT, console.log(`Server is listening ${PORT}`));