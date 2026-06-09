import os
import threading
import tempfile
from server.db.csv_store import CSVStore

def test_csv_store_crud():
    with tempfile.TemporaryDirectory() as tmpdir:
        csv_path = os.path.join(tmpdir, "test.csv")
        store = CSVStore(csv_path, ["id", "name", "age"], "id")
        
        # Test auto-creation
        assert os.path.exists(csv_path)
        
        # Test insert
        store.insert({"id": "1", "name": "Alice", "age": "30"})
        records = store.read_all()
        assert len(records) == 1
        assert records[0]["name"] == "Alice"
        
        # Test read by key
        record = store.read_by_key("1")
        assert record is not None
        assert record["name"] == "Alice"
        
        # Test query
        res = store.query({"name": "Alice"})
        assert len(res) == 1
        
        # Test update
        store.update("1", {"age": "31"})
        record = store.read_by_key("1")
        assert record["age"] == "31"
        
        # Test upsert (insert)
        store.upsert("2", {"id": "2", "name": "Bob", "age": "25"})
        assert len(store.read_all()) == 2
        
        # Test upsert (update)
        store.upsert("2", {"id": "2", "name": "Bob", "age": "26"})
        assert store.read_by_key("2")["age"] == "26"
        
        # Test delete
        store.delete("1")
        assert len(store.read_all()) == 1

def test_csv_store_thread_safety():
    with tempfile.TemporaryDirectory() as tmpdir:
        csv_path = os.path.join(tmpdir, "test_threads.csv")
        store = CSVStore(csv_path, ["id", "val"], "id")
        
        def worker(start_id, count):
            for i in range(count):
                store.insert({"id": str(start_id + i), "val": "x"})
                
        threads = []
        for t in range(5):
            thread = threading.Thread(target=worker, args=(t * 100, 100))
            threads.append(thread)
            thread.start()
            
        for thread in threads:
            thread.join()
            
        assert len(store.read_all()) == 500
