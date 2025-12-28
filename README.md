#_**Culinova: Novel Biosensing System & Device for Foodborne Contaminants**_

The novel biosensing system & device facilitate rapid detection of the most common foodborne contaminants, including bacterial pathogens, metabolic toxins, and heavy metals. The laboratory sensing system is constructed based upon novel pairing of nanomaterials and the use of electrochemistry principles combined with the change in luminescence of molecules. It helps to quantify the specific concentration of these contaminants.

The system is concealed in a rigorously designed and portable physical device that can be used in households, communities, and clinical point-of-care settings. It is affordable and has advanced parameters in sensitivity, stability, accuracy, selectivity, and many more parameters compared to other options in the market as the first of its kind.

* Published Paper on Biosensor Device: https://doi.org/10.1117/12.3013202
 
* Biosensor Device Science Fair Display: https://isef.net/project/bchm001-novel-ecl-biosensing-methodology-and-application

The system is paired in use **with the new application developed, SafePlates**. Its current capabilities include scan-to-detect functionality for ingredients and health risks in food and offering an AI assistant in designing a healthy diet for users. The goal is for the application to analyze outputs from the biosensor to interpret the safety level of contaminants quantified and advise users on a personal level.


#_**Backend and APIs Setup**_

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
Environment files should never be committed to version control.

#_**Frontend Setup**_

The frontend provides interface for viewing scan results, analyzing data, and interacting with the system through the mobile app. It communicates directly with the backend APIs.

Ensure Node.js is installed, then navigate to the frontend directory - standard setup procedures.

The frontend will usually be accessible at one of the following addresses depending on configuration:
```python
http://localhost:3000
http://localhost:5173
```

The frontend must be configured to point to the backend API. This is commonly done in a configuration file or environment variable.
```python
const API_BASE_URL = "http://localhost:3000/api";
```

#_**Flutter Mobile App Setup**_

The Flutter application, SafePlates, provides a mobile interface for interacting with all data and messages. It allows users to scan food samples or input personal data, view results, and receive food safety and health guidance.

Install the Flutter SDK and verify the environment.
```python
flutter doctor
```

Navigate to the Flutter directory.
```python
cd Flutter
```

Install Flutter dependencies.
```python
flutter pub get
```

Run the application on an emulator or connected device.
```python
flutter run
```
If running on an Android emulator, the backend API must use the emulator bridge address instead of localhost.
```python
const String apiBaseUrl = "http://10.0.2.2:3000/api";
```
For physical devices, replace the IP address with your machine’s local network IP.

#_**Contributing**_

Contributions are welcome. Keep changes scoped to the relevant component. Any backend API changes should be reflected in both frontend and Flutter clients. New configuration values or environment variables should be documented clearly.

#_**License**_

This project is licensed under the GNU General Public License version 3.0.

This repository provides the software foundation for a scalable and accessible biosensing system focused on improving food safety and public health outcomes.
