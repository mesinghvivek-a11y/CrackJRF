-- Optional seed rows. Run before `npm run seed:syllabus` or use the script which upserts them.
insert into public.subjects(code,name,paper_type,active) values
('00','General Paper on Teaching & Research Aptitude','common',true),
('80','Geography','subject_specific',true)
on conflict(code) do update set name=excluded.name,paper_type=excluded.paper_type,active=true;
insert into public.test_blueprints(code,name,mode,paper_i_question_count,paper_ii_question_count,duration_minutes,marks_per_correct,marks_per_wrong,marks_per_unattempted,settings)
values
('GEOGRAPHY_100_120','Geography Paper II Practice','geography_only',0,100,120,2,0,0,'{"time_per_question_seconds":72,"description":"Dedicated practice configuration; not a separately allotted official Paper II duration."}'),
('UGCNET_FULL_150_180','Complete UGC NET Mock','full_ugc_net',50,100,180,2,0,0,'{"paper_i_code":"00","paper_ii_subject":"selected_by_candidate"}'),
('CUSTOM_GEOGRAPHY','Custom Geography Test','custom',0,0,120,2,0,0,'{"time_per_question_seconds":72}')
on conflict(code) do update set name=excluded.name,mode=excluded.mode,paper_i_question_count=excluded.paper_i_question_count,paper_ii_question_count=excluded.paper_ii_question_count,duration_minutes=excluded.duration_minutes,settings=excluded.settings;
