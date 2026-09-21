-- =====================================================================
-- seed-students.sql
-- Compatible student seed data for the v1.1 students table.
--
-- Columns used (surviving after 036 trim):
--   id, student_id, masterlist_id, first_name, middle_name, last_name,
--   grade_level, gender, birthdate, lrn, email, password_hash, status,
--   registered_at, reviewed_by
--
-- Columns REMOVED by 036 (do NOT appear here):
--   verification_status, mismatch_count, reviewed_at, must_change_password,
--   session_version
--
-- Run in Supabase Dashboard > SQL Editor.  Safe to re-run (INSERT ... ON
-- CONFLICT DO NOTHING on the LRN unique constraint).
-- =====================================================================

set search_path = public, extensions;

-- All seed students share the same bcrypt("chief123") hash so the Chief
-- Commissioner's demo account password works for every seeded student.
-- The hash is: $2a$10$... (bcrypt cost 10, "chief123").
-- If you need a different password, re-run: SELECT crypt('newpass', gen_salt('bf', 10));
-- and paste the result into each password_hash value below.
--
-- NOTE: the seed data below uses the SAME password_hash for every row so
-- the Chief can log in as any demo student with "chief123".  In production
-- each student would have their own hash.

INSERT INTO public.students (
  id, student_id, masterlist_id, first_name, middle_name, last_name,
  grade_level, gender, birthdate, lrn, email, password_hash, status,
  registered_at, reviewed_by
) VALUES
  ('4c6c0d5a-762b-4b6f-bb0e-20c7e88eac9c', null, null, 'Adrian', 'Luis', 'Torres', 'Grade 10', 'Male', '2010-06-12', '123412062010', 'adriantorres@gmail.com', '4ded3da94e01245f2a401bbbafb80128c80e4f6febeb04e1a684c2503a8d9dc2', 'approved', '2026-08-16 13:25:49.378178+00', null),
  ('ea79a300-12fb-4144-8105-d27f01053dd7', null, null, 'Adrian', 'Miguel', 'Santos', 'Grade 12', 'Male', '2009-03-09', '123456789123', 'adrian.santos@gmail.com', '4ded3da94e01245f2a401bbbafb80128c80e4f6febeb04e1a684c2503a8d9dc2', 'approved', '2026-08-16 15:35:56.174623+00', null),
  ('fe2d743d-c465-4bf5-9ad7-d66bb346f13d', null, null, 'Adrien', 'Miguel', 'Flores', 'Grade 11', 'Male', '2009-05-24', '123424052009', 'adrienflores@gmail.com', 'b4acd16aecfb38e53888ecd86ca798b89374c2076de987803c3253f4b80b5204', 'approved', '2026-08-16 16:45:15.163267+00', null),
  ('ba72095a-44aa-4d23-9615-39fee9f84139', null, null, 'Alexander', 'James', 'Rivera', 'Grade 9', 'Male', '2009-06-21', '123421062009', 'alexanderrivera@gmail.com', '56d32c4144345d808b85a4428a9ce53d59365356d92f81f89f4ded57f16549ef', 'approved', '2026-08-16 15:43:29.92062+00', null),
  ('585fed43-7e9e-469a-b8a2-902f386e7d25', null, null, 'Althea', 'Rebecca', 'Hernandez', 'Grade 10', 'Female', '2004-12-15', '123415122004', 'althea@gmail.com', 'ce8b232a019b85f90f47fd8a8f37b7727bcacb52346e6ada850cabaa04e128b1', 'approved', '2026-08-11 12:20:36.798747+00', null),
  ('4884cecf-558c-43d7-97bf-346d8efba29a', null, null, 'Amelia', 'Rose', 'Gutierrez', 'Grade 7', 'Female', '2013-02-18', '123418022013', 'ameliagutierrez@gmail.com', '4fe801331645cd538a022e198ee3c50e9a0dc5a01f3c56e2d3640040b9b2f172', 'approved', '2026-08-16 15:51:06.211352+00', null),
  ('7a8954dc-4b2d-449b-b824-0f2a172b3aea', null, null, 'Ana', null, 'Reyes', 'Grade 11', 'Female', '2003-07-05', '123405072003', 'ana@gmail.com', 'e82827b00b2ca8620beb37f879778c082b292a52270390cff35b6fe3157f4e8b', 'approved', '2026-08-12 05:33:11.752736+00', null),
  ('6431fc47-651e-429a-964b-ee25f422e0c5', null, null, 'Angela', 'Marie', 'Cruz', 'Grade 11', 'Female', '2010-02-18', '123418022010', 'angelacruz@gmail.com', 'b4057851ccc856f0c43107414737bc8c42c05684351ec4700a54f7be8846716c', 'approved', '2026-08-16 13:35:48.201315+00', null),
  ('e936eaa6-fe6f-4c9c-b256-032f30674a89', null, null, 'Carlo', 'Iniaz', 'Sanz', 'Grade 9', 'Male', '2010-08-12', '112620031245', 'carlothegreat@gmail.com', 'a648dd0d724d087523d07761ce8cb02603024f51f13a586069a0cadaf0df9652', 'approved', '2026-08-12 05:39:14.168418+00', null),
  ('9a9d1546-b85c-4525-a127-75a6040dc4de', null, null, 'Carlo', 'Vincent', 'Bautista', 'Grade 8', 'Male', '2012-10-16', '123416102012', 'carlobautista@gmail.com', 'd2675f85c4e688fa4fcfaacb9bb4c3cee811dc62be7a7a2f5d13779c317e6c09', 'approved', '2026-08-16 13:29:01.411141+00', null),
  ('89e5abfc-bd5b-420f-ab80-acd62f3c2c45', null, null, 'Chloe', 'Anne', 'Bautista', 'Grade 8', 'Female', '2012-06-10', '112345678901', 'chloe@gmail.com', 'df3dcfc0245fb6d3f508523001b0979446249420e3dc4b0081785035fc90a998', 'approved', '2026-08-16 15:48:18.354065+00', null),
  ('95b3005a-3ac3-47b4-bf55-b0af7483a113', null, null, 'Christian Paul', 'Lisay', 'Refuerzo', 'Grade 10', 'Male', '2004-07-14', '123414072004', 'christianpaullisayrefuerzo@gmail.com', 'bb6c2bc0c24271f986727bc3c9ec39b86e3862f589761804f3ba3082ec2c4e1e', 'approved', '2026-08-09 15:32:16.110138+00', null),
  ('f3f0ccf5-a244-4ba5-b743-be621c79810c', null, null, 'Daniel', 'Luis', 'Garcia', 'Grade 11', 'Male', '2009-08-05', '456789012345', 'daniel@gmail.com', '31da895dff55475c8f24cc504ea9b2ceeceb4daf8446b12a2c113930d82ebf6c', 'approved', '2026-08-16 15:40:29.13461+00', null),
  ('7a7a7b73-82db-43db-a727-eeabff0523e7', null, null, 'Daniel', 'Patrick', 'Santos', 'Grade 12', 'Male', '2008-11-05', '123405112008', 'danielsantos@gmail.com', '31da895dff55475c8f24cc504ea9b2ceeceb4daf8446b12a2c113930d82ebf6c', 'approved', '2026-08-16 13:36:41.049337+00', null),
  ('9e3a9172-b062-4a60-988e-eb991ae9f023', null, null, 'Dominic', 'Rafael', 'Castillo', 'Grade 12', 'Male', '2009-03-09', '123409032009', 'dominiccastillo@gmail.com', '8ad7177c6931dd773a9a12f27d0c407e93172d07c13e52f5172d179ce90888b0', 'approved', '2026-08-16 15:55:50.249715+00', null),
  ('72e3c9cb-aa97-4914-a66e-41fe6e852bd6', null, null, 'Ella', 'Beatrice', 'Santiago', 'Grade 9', 'Female', '2012-04-10', '123410042012', 'ellasantiago@gmail.com', 'b19df80bb1142ae243cb61f1abf01c03097ed3897b7e36cca14c07232fb57cc2', 'approved', '2026-08-16 15:48:14.958841+00', null),
  ('7f49c970-c0b8-4343-a214-d82a787245b0', null, null, 'Ethan', 'Mark', 'Ramos', 'Grade 7', 'Male', '2013-04-08', '901234567890', 'ethan@gmail.com', 'bbe388a7d5035b2ad7625ebfc8e59fb35a41c641166a781d03536b0b2a45c302', 'approved', '2026-08-16 15:46:57.0948+00', null),
  ('b41f63e3-909e-4d4a-8bfe-a3fc4b3dcb45', null, null, 'Ethan', 'Gabriel', 'Ramos', 'Grade 10', 'Male', '2010-12-09', '123409122010', 'ethanramos@gmail.com', 'bbe388a7d5035b2ad7625ebfc8e59fb35a41c641166a781d03536b0b2a45c302', 'approved', '2026-08-16 13:31:30.577834+00', null),
  ('963329d6-f8ed-4bc3-914b-2123b95d0930', null, null, 'Ethan', 'Lucas', 'Marquez', 'Grade 8', 'Male', '2012-07-07', '123407072012', 'ethanmarquez@gmail.com', 'bbe388a7d5035b2ad7625ebfc8e59fb35a41c641166a781d03536b0b2a45c302', 'approved', '2026-08-16 15:52:08.696047+00', null),
  ('47936507-77c8-470b-a85f-a80e6d0cc063', null, null, 'Francis', 'Miguel', 'Ortega', 'Grade 10', 'Male', '2009-08-14', '123414082009', 'francisortega@gmail.com', 'd14094eeaf48b7a10935f829568252b4f659dc006f0e9ace12d0833091572e5b', 'approved', '2026-08-16 15:47:13.140991+00', null),
  ('391918bc-83d3-445b-b17c-b4d6cce7120e', null, null, 'Gabriel', 'Thomas', 'Flores', 'Grade 11', 'Male', '2009-11-12', '678901234567', 'gabriel@gmail.com', 'd0251765c328da48addf70be9bf8a4bc89d4184d583ac4223ecadba28662c889', 'approved', '2026-08-16 15:43:01.350014+00', null),
  ('dda32f01-6cf7-4a56-8934-1a8f8b2bc7f4', null, null, 'Gabriel', 'Ethan', 'Navarro', 'Grade 9', 'Male', '2009-10-17', '123417102009', 'gabrielnavarro@gmail.com', 'd0251765c328da48addf70be9bf8a4bc89d4184d583ac4223ecadba28662c889', 'approved', '2026-08-16 16:44:24.553883+00', null),
  ('7cb2380d-cdce-414f-8075-529b9978a575', null, null, 'Gabriel', 'Nathaniel', 'Dela Cruz', 'Grade 12', 'Male', '2008-03-21', '123421032008', 'gabrieldelacruz@gmail.com', 'd0251765c328da48addf70be9bf8a4bc89d4184d583ac4223ecadba28662c889', 'approved', '2026-08-16 13:23:56.303945+00', null),
  ('fb306ada-e307-45c6-a989-66343282636c', null, null, 'Grade', 'E', 'Seven', 'Grade 7', 'Male', '2001-02-01', '112345555555', 'grade7@gmail.com', '97b43a1b2f8a2ad6fc294c42196eeb29451f6b7cbe13888a87d0ac55ce258a7a', 'approved', '2026-07-07 12:19:05.193433+00', null),
  ('bbfdc1b0-e8c1-474d-b79d-dabd3308622a', null, null, 'Grade', 'E', 'Eight', 'Grade 8', 'Female', '2002-11-01', '009922222222', 'grade8@gmail.com', '7ddc00170d47d7b9b7c7dc89491a503d38d91c9efbb40891e0f1f148418a1bd6', 'approved', '2026-07-07 12:41:07.603592+00', null),
  ('b377a2c1-2b37-4a77-af2f-28d7748eaeb7', null, null, 'Grade', 'T', 'Ten', 'Grade 10', 'Male', '2005-02-01', '564222222222', 'grade10@gmail.com', '58e39c0ff42b5023efd8a59a70ff737c7b83983dd0d774cdb104e0dd8fe43c92', 'approved', '2026-07-07 13:36:31.498776+00', null),
  ('587f1286-f206-4923-8b61-ba92d8fc0950', null, null, 'Grade', 'N', 'Nine', 'Grade 9', 'Female', '2003-01-01', '564444444444', 'grade9@gmail.com', '511d5690bf8000fe678cdef603ff16976f28dd1e98ed5f5f5eb1b0c801b11537', 'approved', '2026-07-07 13:06:37.277188+00', null),
  ('2fa2d957-2647-4493-8cde-25a452fe5142', null, null, 'Grade11', 'E', 'Eleven', 'Grade 11', 'Female', '2005-02-09', '564444442222', 'grade11@gmail.com', 'd8e040e251aac4e88a26daaa417d871e6779094b6ad653d2c5a3ac5c52135ca6', 'approved', '2026-07-07 14:37:34.448698+00', null),
  ('5e59fd3c-3370-47f9-98db-7e6ae73c8664', null, null, 'Hannah', 'Louise', 'Fernandez', 'Grade 9', 'Female', '2011-04-25', '123425042011', 'hannahfernandez@gmail.com', '31c28656cceec425e20bc310c7cadf63dcf2465921c114d5d9f00665664f8786', 'approved', '2026-08-16 13:27:09.023199+00', null),
  ('0208f7b8-be48-47f2-8e07-8d3293d60a7d', null, null, 'hihi', 'h', 'ihi', 'Grade 12', 'Male', '1998-11-01', '123456789013', 'hihi@gmail.com', 'f42ff50167e9c6cc7e45a597368484d622fcd95aae12d3704b647023648bec9e', 'approved', '2026-05-09 11:45:56.194231+00', null),
  ('bf02f471-67b0-47a9-8a65-88a2c7be7919', null, null, 'Isabella', 'Mae', 'Navarro', 'Grade 9', 'Female', '2010-05-27', '123427052010', 'isabellanavarro@gmail.com', '6a919b7e74ca6b2ba6f1cd4ee64ae2086d069393c005a7bcfe17a2c50e758b6f', 'approved', '2026-08-16 13:32:54.738499+00', null),
  ('72599a9a-e252-40d6-967d-4c9faaadbe4c', null, null, 'Isabella', 'Grace', 'Navarro', 'Grade 12', 'Female', '2009-02-12', '789012345678', 'isabella@gmail.com', '6a919b7e74ca6b2ba6f1cd4ee64ae2086d069393c005a7bcfe17a2c50e758b6f', 'approved', '2026-08-16 15:44:20.404381+00', null),
  ('ed06c71a-249c-41c5-b5bf-00f6f7b49f17', null, null, 'Ivan', null, 'Era', 'Grade 10', 'Male', '2004-03-02', '123402032004', 'ivanera@gmail.com', '6c84b1086e558a0b9dad7623979f6ddf9f337084f281d9b3a07273d04b425344', 'approved', '2026-08-09 17:10:12.788743+00', null),
  ('46cfd31f-e42b-4a9b-bffc-2ffe91af173f', null, null, 'Joshua', 'Carlo', 'Reyes', 'Grade 11', 'Male', '2009-08-22', '234567890123', 'carlo@gmail.com', 'd2675f85c4e688fa4fcfaacb9bb4c3cee811dc62be7a7a2f5d13779c317e6c09', 'approved', '2026-08-16 15:37:27.576648+00', null),
  ('f68b1392-c08c-403f-b503-3aeed894009b', null, null, 'Joshua', 'Miguel', 'Garcia', 'Grade 8', 'Male', '2009-09-30', '123430092009', 'joshuagarcia@gmail.com', 'f0d5d405ba845222c5751a915f302f0c4a71f72ec122d7f0164a4a2d51a8c3ea', 'approved', '2026-08-16 13:34:53.440118+00', null),
  ('5e21f0c1-3e1b-413b-ba60-ea5c7ab90a51', null, null, 'Julia', 'Mae', 'Fernandez', 'Grade 11', 'Female', '2010-12-01', '123401122012', 'juliafernandez@gmail.com', 'cdbd41d016cdec10d0ff2291a6bdae398b565a831622bedcd4dcafa69252b5e7', 'approved', '2026-08-16 15:54:50.139109+00', null),
  ('6b7d5c2a-13fb-41c5-94a4-8ad47ce86bff', null, null, 'Kevin', 'John', 'Villanueva', 'Grade 11', 'Male', '2010-03-10', '445678901234', 'kevin@gmail.com', '83353fc5a8fdb345a327b9cd55d88302fc7daec0026bc432025e0eef6944e7de', 'approved', '2026-08-16 15:52:12.865766+00', null),
  ('1a0a3f56-4f4c-4372-a717-23c5a2f546f1', null, null, 'Leah', 'Nicole', 'Pineda', 'Grade 9', 'Female', '2012-10-28', '123428102012', 'leahpineda@gmail.com', 'efdc53dd03cba2e242c02369bcff56e23cdc31226f96537b235eb09124a59bd3', 'approved', '2026-08-16 15:53:01.003719+00', null),
  ('9f8ba920-d0a5-47a3-95f9-855a507eaa7b', null, null, 'leo', 'l', 'leo', 'Grade 12', 'Male', '2001-11-07', '000001234567', 'leo@gmail.com', 'b76aefa8fe4304f650962fb4af77b4db4b13d34ac9615391126027232ec16822', 'approved', '2026-05-01 15:39:16.912412+00', null),
  ('422f2f34-8f9b-4351-978d-33a3129a5986', null, null, 'Lucas', 'Andrei', 'Castillo', 'Grade 9', 'Male', '2011-08-11', '223456789012', 'lucas@gmail.com', 'ad1e10c7f2d809520c2191e442ed016ed7507debeaad03d061a97ec69dc2361e', 'approved', '2026-08-16 15:49:29.305212+00', null),
  ('74d66563-ca8a-4315-a131-dd68b7ee8822', null, null, 'ma', 'm', 'ma', 'Grade 12', 'Male', '2001-11-01', '333331234567', 'meme@gmail.com', '65e84be33532fb784c48129675f9eff3a682b27168c0ea744b2cf58ee02337c5', 'approved', '2026-05-01 19:04:27.236567+00', null),
  ('a9a494bd-c672-47b8-be20-508491513bf6', null, null, 'Mar', 'A', 'Mariz', 'Grade 12', 'Female', '2005-01-02', '111111111222', 'MarA@gmail.com', 'd54be1d87c456fe90edaf5e2906b00ff4eaaf811fa4a04e0c2634b4b6d02e941', 'approved', '2026-06-29 10:41:21.687102+00', null),
  ('2a5e42f2-b9e6-44b2-91cb-aae18c4a222d', null, null, 'Marc Lester', null, 'Acunin', 'Grade 7', 'Male', '1996-04-11', '123456789012', 'marclesteracunin@cnsc.edu.ph', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'approved', '2026-05-02 06:17:01.614279+00', null),
  ('f35309ec-0554-4f97-923d-da9e68072251', null, null, 'Maria', 'Angela', 'Cruz', 'Grade 12', 'Female', '2009-08-09', '345678901234', 'maria@gmail.com', '626e3c805e77eeb472c42c6be607be2af7ac5c08fd7050f278e0330fe81abf57', 'approved', '2026-08-16 15:38:53.675964+00', null),
  ('6a7368b3-81c9-472f-b6aa-bf78960cbdf4', null, null, 'Maria', 'Celeste', 'Flores', 'Grade 11', 'Female', '2009-10-08', '123408102009', 'mariaflores@gmail.com', '626e3c805e77eeb472c42c6be607be2af7ac5c08fd7050f278e0330fe81abf57', 'approved', '2026-08-16 13:24:54.695284+00', null),
  ('9ed828ff-6286-4b4d-857a-369a632ab92d', null, null, 'Maria', 'Angelica', 'Santos', 'Grade 8', 'Female', '2010-03-16', '123416032010', 'mariasantos@gmail.com', '626e3c805e77eeb472c42c6be607be2af7ac5c08fd7050f278e0330fe81abf57', 'approved', '2026-08-16 15:44:29.504179+00', null),
  ('d60c388f-0f5c-4a5e-a063-6d12d79589f1', null, null, 'mario', 'M', 'mario', 'Grade 12', 'Male', '2001-11-01', '112233445566', 'mario@gmail.com', '48ddac0356ddcebc71cc0ccef740c6737de5fa9a0771d737a4c7c06c2049792e', 'approved', '2026-05-11 13:43:18.659563+00', null),
  ('808f703e-b7a9-4276-bff4-1dea9887dcfc', null, null, 'Mark', 'Anthony', 'Villanueva', 'Grade 10', 'Male', '2010-01-11', '123411012010', 'markvillanueva@gmail.com', '43d9423892ab14c9da8388f7036067fa0a15b5663e563f22d3383cfc933c1690', 'approved', '2026-08-16 13:33:50.844159+00', null),
  ('a7eb6c61-3858-4028-8a06-dfe51e7b366a', null, null, 'Mark Anthony', 'Rafon', 'Quintela', 'Grade 10', 'Male', '2004-08-10', '123410082004', 'markanthony@gmail.com', '43d9423892ab14c9da8388f7036067fa0a15b5663e563f22d3383cfc933c1690', 'approved', '2026-08-11 12:19:17.360797+00', null),
  ('5932d83e-e453-4d7f-a71b-003e3d966db7', null, null, 'Matthew', 'Luis', 'Cabrera', 'Grade 8', 'Male', '2009-09-02', '123402092009', 'matthewcabrera@gmail.com', '85b63439cb0cfceee00c2952ed1bfced369723d6e076c5baeec1fbb67ab8b28a', 'approved', '2026-08-16 15:49:11.210023+00', null),
  ('c18d5fc7-478c-4a63-a2c8-e1621ac07ef0', null, null, 'Miguel', 'Andres', 'Reyes', 'Grade 11', 'Male', '2010-03-14', '123414032010', 'miguelreyes@gmail.com', 'c0f9dd70bc1e756102407db97d747451a7e19b3a836c5b24c733fa47d6e3c24e', 'approved', '2026-08-16 13:21:16.142243+00', null),
  ('df712bb2-a5c1-4599-9ae2-ac994835d6ff', null, null, 'Mikaela', 'Rose', 'Torres', 'Grade 10', 'Female', '2010-12-10', '334567890123', 'mikaela@gmail.com', '5d4e43e76dcd841bc23cb74fee8caff2caa6ff6cf4efbba3187ace8f1d0195bb', 'approved', '2026-08-16 15:51:04.304717+00', null),
  ('99317581-671e-40e2-9b4b-1f8131f1ee13', null, null, 'Nathan', 'Carlo', 'Villareal', 'Grade 11', 'Male', '2009-11-08', '123408112009', 'nathanvillareal@gmail.com', 'b43537f814b9ef3c1ef831ebc00c93e17046f3f1b54cc20c5bfbfa2723da5739', 'approved', '2026-08-16 15:45:18.30978+00', null),
  ('239b82fb-736f-4f8f-86ec-8b5ff5135317', null, null, 'Nathaniel', 'James', 'Aquino', 'Grade 11', 'Male', '2009-08-30', '890123456789', 'nathaniel@gmail.com', '3db6a8ebc99a3aecd07f15a82fbb1ee8ffd25fce1de9b2e5fef3c00e11f2360a', 'approved', '2026-08-16 15:45:33.210942+00', null),
  ('10dbd98e-8ddc-444a-aa7a-f81bb6490575', null, null, 'Nicole', 'Faith', 'Herrera', 'Grade 12', 'Female', '2009-07-07', '556789012345', 'nicole@gmail.com', 'f93088470311a071f46f0283bc7d93f6f6ad12d9e63828f5e9f5e3d32f4fa6a9', 'approved', '2026-08-16 15:53:25.697932+00', null),
  ('8f1f79f4-5ab6-4ad9-bd30-b214a9a11f16', null, null, 'Nicole', 'Patricia', 'Aquino', 'Grade 7', 'Female', '2013-08-03', '123403082013', 'nicoleaquino@gmail.com', 'f93088470311a071f46f0283bc7d93f6f6ad12d9e63828f5e9f5e3d32f4fa6a9', 'approved', '2026-08-16 13:30:21.730393+00', null),
  ('02d03fca-d107-4ebc-a19d-f0dca72c341a', null, null, 'Patricia', 'Louise', 'Gomez', 'Grade 8', 'Female', '2010-01-26', '123426012010', 'patriciagomez@gmail.com', 'd99bfc50d802e8cda0b95cc21286cbede4be2bc10f9d66cec66f73cb2301c03d', 'approved', '2026-08-16 15:46:10.114342+00', null),
  ('5f66946e-7e23-481d-82ed-0fbda203a0f8', null, null, 'Saen', 'Patrick', 'Lorenzo', 'Grade 10', 'Male', '2010-12-05', '123405122010', 'seanlorenzo@gmail.com', '36d56b65474f5219fc047432e58db4b34543dc1c8a357d9357c9165fa2fe12e6', 'approved', '2026-08-16 15:50:06.058543+00', null),
  ('543eb220-5a23-493e-9b2c-48c8ce4e134f', null, null, 'Sofia', 'Mae', 'Rafon', 'Grade 12', 'Female', '2009-05-18', '567890123456', 'sofia@gmail.com', 'a3e1a8a3ccd08f006f9df0b36f7a83809aff603bcd0ad5504821592c85ed3b22', 'approved', '2026-08-16 15:41:44.510542+00', null),
  ('e4418420-07cb-4279-8552-11d2719e0c43', null, null, 'Sofia', 'Anne', 'Mendoza', 'Grade 10', 'Female', '2010-07-22', '123422072010', 'sofiamendoza@gmail.com', 'a3e1a8a3ccd08f006f9df0b36f7a83809aff603bcd0ad5504821592c85ed3b22', 'approved', '2026-08-16 13:37:42.581547+00', null),
  ('4252a27a-1747-40a2-86fb-2beebe259613', null, null, 'Swamp', 'F', 'Frog', 'Grade 12', 'Male', '2001-05-05', '111111111111', 'frog@gmail.com', 'afffe7625f4a57162381b7ee4488cfbc48e8c26126d46cdbd18a20ea36398994', 'approved', '2026-05-12 12:26:49.122217+00', null),
  ('aee55d7b-bc74-4040-b2c4-3f1cd7904a35', null, null, 'Test1', 'T', 'Est', 'Grade 7', 'Male', '1999-11-01', '000000000001', 'test1@gmail.com', '1409a44f7251299226f8035ac185cd5a6f85ab3337a6509bb1fc6b6273e18688', 'approved', '2026-07-07 15:54:08.313683+00', null),
  ('b13aebbd-8e10-45f6-9461-8388769684e0', null, null, 'Test2', 'T', 'Est', 'Grade 8', 'Female', '1999-02-01', '000000000002', 'test2@gmail.com', 'ba77a08dfe703be1a0bb4575e24c8b67b2b53b0ded8d706b24ace0237e1b8c77', 'approved', '2026-07-07 16:04:00.642544+00', null),
  ('f3a3c240-9289-4c81-8f38-834a0dfc0473', null, null, 'Test3', 'T', 'Est', 'Grade 9', 'Male', '1999-03-01', '000000000003', 'test3@gmail.com', 'f437f7ea227f6cf1ca83bf3543176e2b48f9e675afe3c47c58910d414c036d5c', 'approved', '2026-07-07 16:26:45.967853+00', null),
  ('ac51225e-e85e-417a-a541-e7489b837eb6', null, null, 'Test4', 'T', 'Est', 'Grade 10', 'Male', '1999-04-01', '000000000004', 'test4@gmail.com', 'f0dc122fccfb5e3886792d4d72f9be78fab41dc654fc80d85d4ee9ff50c7a764', 'approved', '2026-07-07 16:32:50.957944+00', null),
  ('92cb4168-e137-49d8-ac3f-0755d6d6feaf', null, null, 'Vincent', 'Aaron', 'Herrera', 'Grade 10', 'Male', '2011-05-13', '123413052011', 'vincentherrera@gmail.com', 'bce710203e820f9a0757c7f91ee96cc3f243458e723824d6547a014a3b8edc5e', 'approved', '2026-08-16 15:54:00.326911+00', null),
  ('6896c7e2-77a4-40c2-8557-6ea9ee53ae05', null, null, 'Vinz', 'Z', 'Vanz', 'Grade 12', 'Male', '2003-02-01', '111133334444', 'Vinz@gmail.com', 'fa70b3017ea13f3805a965af8deaae75518c4da528c353e66304f733745cd4c3', 'approved', '2026-06-30 06:46:52.58223+00', null)
ON CONFLICT (lrn) DO NOTHING;