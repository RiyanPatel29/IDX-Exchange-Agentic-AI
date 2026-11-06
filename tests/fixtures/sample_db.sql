-- FAKE sample rows for local testing only (not real MLS data).
-- Same column names/types as the real tables, just the columns Weeks 3-6 use.
DROP TABLE IF EXISTS rets_property;
CREATE TABLE rets_property (
  id INT AUTO_INCREMENT PRIMARY KEY,
  L_ListingID VARCHAR(50), L_DisplayId VARCHAR(50), L_Address VARCHAR(255),
  L_City VARCHAR(100), L_Zip VARCHAR(20), L_Type_ VARCHAR(100),
  L_Keyword2 INT, LM_Dec_3 DECIMAL(4,1), L_SystemPrice INT, LM_Int2_3 INT,
  LMD_MP_Latitude DECIMAL(18,15), LMD_MP_Longitude DECIMAL(19,15),
  L_Status VARCHAR(50), StandardStatus VARCHAR(50), L_Remarks MEDIUMTEXT, L_Photos LONGTEXT,
  LA1_UserFirstName VARCHAR(100), LA1_UserLastName VARCHAR(100), LO1_OrganizationName VARCHAR(255),
  YearBuilt INT, AssociationFee INT, DaysOnMarket INT,
  PoolPrivateYN VARCHAR(10), FireplaceYN VARCHAR(10), ViewYN VARCHAR(10), PhotoCount INT
);
INSERT INTO rets_property
 (L_ListingID,L_DisplayId,L_Address,L_City,L_Zip,L_Type_,L_Keyword2,LM_Dec_3,L_SystemPrice,LM_Int2_3,LMD_MP_Latitude,LMD_MP_Longitude,L_Status,StandardStatus,L_Remarks,L_Photos,LA1_UserFirstName,LA1_UserLastName,LO1_OrganizationName,YearBuilt,AssociationFee,DaysOnMarket,PoolPrivateYN,FireplaceYN,ViewYN,PhotoCount)
VALUES
 ('1001','OC1001','1 Test Ln','Irvine','92618','Condominium',3,2.0,1150000,1450,33.66,-117.82,'Active','Active','Bright corner unit with mountain views, remodeled kitchen with quartz counters and a quiet interior location near the community pool.','["https://example.com/a.jpg"]','Ana','Lee','Sample Realty',2015,420,12,'True','False','False',18),
 ('1002','OC1002','2 Test Ln','Irvine','92620','Condominium',2,2.0,899000,1100,33.70,-117.78,'Active','Active','Updated kitchen, new flooring and a private patio. Walk to Woodbridge lakes, parks and top rated schools.','[]','Ben','Kim','Sample Realty',2008,380,30,'False','False','True',22),
 ('1003','OC1003','3 Test Ln','Irvine','92618','SingleFamilyResidence',4,3.0,1890000,2600,33.67,-117.80,'Active','Active','Entertainers dream on a cul-de-sac: sparkling pool and spa, outdoor kitchen, three car garage and solar panels.','[]','Cal','Ng','Demo Homes',2001,150,5,'True','True','False',40),
 ('1004','OC1004','4 Test Ln','Irvine','92618','Condominium',3,2.5,1395000,1700,33.66,-117.81,'Pending','Pending','In escrow. Single level end unit with vaulted ceilings.','[]','Dee','Ray','Demo Homes',2019,450,45,'True','False','False',25),
 ('1005','SD1005','5 Test Ln','San Diego','92101','Townhouse',2,2.5,799000,1300,32.71,-117.16,'Active','Active','Modern downtown townhome steps from the Gaslamp, rooftop deck with ocean and city views, EV charger in garage.','[]','Eve','Park','Coast Realty',2012,300,9,'False','False','True',15),
 ('1006','SD1006','6 Test Ln','San Diego','92103','SingleFamilyResidence',3,2.0,1250000,1800,32.74,-117.16,'Active','Active','Charming 1925 Craftsman bungalow with original hardwood floors, big front porch and a detached studio for a home office.','[]','Fay','Cho','Coast Realty',1925,0,60,'False','True','False',30),
 ('1007','OC1007','7 Test Ln','Irvine','92612','Condominium',3,2.0,1249000,1500,33.65,-117.83,'Active','Active','Brand new construction near the park, smart home features, energy efficient, open floor plan and a large primary suite.','[]','Gus','Vo','Sample Realty',2018,510,2,'True','False','False',20),
 ('1008','OC1008','8 Test Ln','Tustin','92780','SingleFamilyResidence',3,2.0,1095000,1650,33.74,-117.82,'Active','Active','Quiet tree lined street, fully renovated with a big backyard for kids and dogs, close to Old Town Tustin.','[]','Hal','Wu','Demo Homes',1972,0,15,'False','True','False',28),
 ('1009','OC1009','9 Test Ln','Tustin','92782','Condominium',2,2.0,749000,1050,33.71,-117.80,'Active','Active','Turnkey Tustin Ranch condo with garage, low HOA and a short walk to shopping and restaurants.','[]','Ida','Ho','Coast Realty',1999,350,22,'False','False','False',19);

DROP TABLE IF EXISTS california_sold;
CREATE TABLE california_sold (
  ListingKey BIGINT, ClosePrice DOUBLE, CloseDate VARCHAR(20), OriginalListPrice DOUBLE, ListPrice DOUBLE,
  DaysOnMarket BIGINT, PropertyType VARCHAR(50), PropertySubType VARCHAR(50), LivingArea DOUBLE,
  BedroomsTotal DOUBLE, BathroomsTotalInteger DOUBLE, YearBuilt DOUBLE, City VARCHAR(100), PostalCode VARCHAR(20),
  UnparsedAddress VARCHAR(255), ListAgentFullName VARCHAR(255), ListOfficeName VARCHAR(255), BuyerOfficeName VARCHAR(255)
);
INSERT INTO california_sold VALUES
 (2001,1180000,DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH,'%Y-%m-%d'),1199000,1199000,14,'Residential','Condominium',1500,3,2,2016,'Irvine','92618','10 Sold St','Ana Lee','Sample Realty','Buyer Co'),
 (2002,1950000,DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH,'%Y-%m-%d'),2050000,1999000,40,'Residential','SingleFamilyResidence',2700,4,3,2003,'Irvine','92618','11 Sold St','Cal Ng','Demo Homes','Buyer Co'),
 (2003,905000,DATE_FORMAT(CURDATE() - INTERVAL 20 MONTH,'%Y-%m-%d'),899000,899000,7,'Residential','Condominium',1100,2,2,2009,'Irvine','92620','12 Sold St','Ben Kim','Sample Realty','Buyer Co'),
 (2004,3500,DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH,'%Y-%m-%d'),3500,3500,10,'ResidentialLease','Condominium',1200,2,2,2010,'Irvine','92618','13 Sold St','X Y','Lease Co','Buyer Co'),
 (2005,1300000,'2072-06-29',1300000,1300000,10,'Residential','Condominium',1600,3,2,2017,'Irvine','92618','14 Typo St','Z Q','Sample Realty','Buyer Co'),
 (2006,0,'',0,0,0,'Residential','Condominium',0,0,0,0,'Irvine','92618','15 Blank St','Z Q','Sample Realty','Buyer Co');

-- Week 5: Tustin sales with easy numbers so the median / $ per sqft checks are exact.
-- 5 good sales: prices 700k, 800k, 900k, 1.0M, 2.5M (median 900k), 1000 sqft each (median $900/sqft),
-- DOM 10..50 (median 30), 2 of 5 sold over asking. Plus a lease and a $1 typo that must be ignored.
INSERT INTO california_sold VALUES
 (3001,700000,DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH,'%Y-%m-%d'),720000,720000,10,'Residential','Condominium',1000,2,2,2000,'Tustin','92780','1 Tustin Sold','A B','Coast Realty','Buyer Co'),
 (3002,800000,DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH,'%Y-%m-%d'),780000,780000,20,'Residential','Condominium',1000,2,2,2000,'Tustin','92780','2 Tustin Sold','A B','Coast Realty','Buyer Co'),
 (3003,900000,DATE_FORMAT(CURDATE() - INTERVAL 3 MONTH,'%Y-%m-%d'),900000,900000,30,'Residential','SingleFamilyResidence',1000,3,2,2000,'Tustin','92782','3 Tustin Sold','A B','Coast Realty','Buyer Co'),
 (3004,1000000,DATE_FORMAT(CURDATE() - INTERVAL 4 MONTH,'%Y-%m-%d'),950000,950000,40,'Residential','SingleFamilyResidence',1000,3,2,2000,'Tustin','92782','4 Tustin Sold','A B','Coast Realty','Buyer Co'),
 (3005,2500000,DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH,'%Y-%m-%d'),2600000,2600000,50,'Residential','SingleFamilyResidence',1000,4,3,2000,'Tustin','92782','5 Tustin Sold','A B','Coast Realty','Buyer Co'),
 (3006,4200,DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH,'%Y-%m-%d'),4200,4200,5,'ResidentialLease','Condominium',1000,2,2,2000,'Tustin','92780','6 Tustin Lease','A B','Coast Realty','Buyer Co'),
 (3007,1,DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH,'%Y-%m-%d'),900000,900000,5,'Residential','Condominium',1000,2,2,2000,'Tustin','92780','7 Tustin Typo','A B','Coast Realty','Buyer Co');
