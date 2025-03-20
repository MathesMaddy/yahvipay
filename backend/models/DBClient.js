const mongodb = require('mongodb');

const DBClient = () => {
    const uri = 'mongodb://localhost:27017';
    return new mongodb.MongoClient(uri);
}

export default DBClient;