_**Novel Biosensing System & Device for Foodborne Contaminants**_

The novel biosensing system & device facilitate rapid detection of the most common foodborne contaminants, including bacterial pathogens, metabolic toxins, and heavy metals. The laboratory sensing system is constructed based upon novel pairing of nanomaterials and the use of electrochemistry principles combined with the change in luminescence of molecules. It helps to quantify the specific concentration of these contaminants.

The system is concealed in a rigorously designed and portable physical device that can be used in households, communities, and clinical point-of-care settings. It is affordable and has advanced parameters in sensitivity, stability, accuracy, selectivity, and many more parameters compared to other options in the market as the first of its kind.

* Published Paper on Biosensor Device: https://doi.org/10.1117/12.3013202
 
* Biosensor Device Science Fair Display: https://isef.net/project/bchm001-novel-ecl-biosensing-methodology-and-application

The system is paired in use **with the new application developed, SafePlates**. Its current capabilities include scan-to-detect functionality for ingredients and health risks in food and offering an AI assistant in designing a healthy diet for users. The goal is for the application to analyze outputs from the biosensor to interpret the safety level of contaminants quantified and advise users on a personal level.


_**Backend and APIs Setup**_

The backend for the APP acts as the central communication layer. It receives processes scan results, calls important APIs, and manages any required storage or analytics.

Prerequisites for the backend include Node.js version 18 or higher and npm or yarn. After cloning the repository, navigate into the backend directory.

```python
cd "Backend & APIs"
```

Install dependencies.
```python
npm install
```

or, if using yarn,
```python
yarn install
```

To start the backend server in development mode, run:
```python
npm run dev
```

or for a standard start,
```python
npm start
```


The backend will typically be available at:
```python
http://localhost:3000
```


If environment variables are required, create a .env file in the Backend and APIs directory.
```python
PORT=3000
DATABASE_URL=your_database_url
API_KEY=your_api_key
```




