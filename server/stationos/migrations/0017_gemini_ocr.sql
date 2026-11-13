ALTER TABLE st_tanker_document_reads
 MODIFY COLUMN provider ENUM('LOCAL','OPENAI','GEMINI') NOT NULL;
