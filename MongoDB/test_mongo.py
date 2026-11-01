import os
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv()
print(MongoClient(os.environ["MONGO_URI"]).admin.command("ping"))