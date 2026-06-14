package com.example.tautracker

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.example.tautracker.core.security.SecureStorage
import com.example.tautracker.data.remote.MoodleApi
import com.example.tautracker.domain.repository.CourseRepository
import com.example.tautracker.ui.auth.LoginScreen
import com.example.tautracker.ui.dashboard.DashboardScreen
import com.example.tautracker.ui.dashboard.DashboardViewModel
import com.example.tautracker.theme.TauTrackerTheme
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val json = Json { ignoreUnknownKeys = true }
        val okHttpClient = OkHttpClient.Builder()
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
                } else {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.NONE })
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl("https://moodle.tau.ac.il/")
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        val moodleApi = retrofit.create(MoodleApi::class.java)
        val courseRepository = CourseRepository(moodleApi)

        setContent {
            TauTrackerTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    var secureStorage by remember { mutableStateOf<SecureStorage?>(null) }
                    
                    LaunchedEffect(Unit) {
                        withContext(Dispatchers.IO) {
                            secureStorage = SecureStorage(applicationContext)
                        }
                    }

                    if (secureStorage == null) {
                        // Show a loading indicator while the hardware Keystore wakes up
                        androidx.compose.foundation.layout.Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = androidx.compose.ui.Alignment.Center
                        ) {
                            androidx.compose.material3.CircularProgressIndicator()
                        }
                    } else {
                        TauTrackerApp(secureStorage!!, courseRepository, moodleApi)
                    }
                }
            }
        }
    }
}

@Composable
fun TauTrackerApp(
    secureStorage: SecureStorage,
    courseRepository: CourseRepository,
    moodleApi: MoodleApi
) {
    val navController = rememberNavController()
    
    val startDestination = if (secureStorage.getToken().isNullOrEmpty()) "login" else "dashboard"

    NavHost(navController = navController, startDestination = startDestination) {
        composable("login") {
            LoginScreen(
                secureStorage = secureStorage,
                onLoginSuccess = {
                    navController.navigate("dashboard") {
                        popUpTo("login") { inclusive = true }
                    }
                }
            )
        }
        composable("dashboard") {
            val viewModel = remember {
                DashboardViewModel(courseRepository, secureStorage)
            }
            DashboardScreen(
                viewModel = viewModel,
                onCourseClick = { courseId ->
                    navController.navigate("course_detail/$courseId")
                },
                onLogoutClick = {
                    secureStorage.clearToken()
                    navController.navigate("login") {
                        popUpTo("dashboard") { inclusive = true }
                    }
                }
            )
        }
        composable("course_detail/{courseId}") { backStackEntry ->
            val courseIdStr = backStackEntry.arguments?.getString("courseId")
            val courseId = courseIdStr?.toLongOrNull() ?: return@composable
            
            com.example.tautracker.ui.courses.CourseDetailScreen(
                courseId = courseId,
                moodleApi = moodleApi,
                secureStorage = secureStorage,
                onBack = { navController.popBackStack() }
            )
        }
    }
}
