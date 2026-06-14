package com.example.tautracker.ui.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.tautracker.data.local.entity.AssignmentEntity
import com.example.tautracker.data.local.entity.CourseEntity
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    onCourseClick: (Long) -> Unit,
    onSettingsClick: () -> Unit,
    onLogoutClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadData()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("TauTracker Dashboard") },
                actions = {
                    TextButton(onClick = onSettingsClick) {
                        Text("Settings")
                    }
                    TextButton(onClick = onLogoutClick) {
                        Text("Logout", color = MaterialTheme.colorScheme.error)
                    }
                }
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading && uiState.courses.isEmpty() && uiState.assignments.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (uiState.error != null && uiState.courses.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(text = uiState.error!!, color = MaterialTheme.colorScheme.error)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(16.dp)
            ) {
                item {
                    Text("Pending Assignments", style = MaterialTheme.typography.titleLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                
                if (uiState.assignments.isEmpty()) {
                    item { Text("No upcoming assignments.") }
                } else {
                    items(uiState.assignments) { assignment ->
                        AssignmentCard(assignment)
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(24.dp))
                    Text("My Courses", style = MaterialTheme.typography.titleLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }

                items(uiState.courses) { course ->
                    CourseCard(course) { onCourseClick(course.id) }
                }
            }
        }
    }
}

@Composable
fun AssignmentCard(assignment: AssignmentEntity) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = assignment.name, style = MaterialTheme.typography.titleMedium)
            
            val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault())
            val dateStr = sdf.format(Date(assignment.dueDate * 1000L))
            
            Text(text = "Due: $dateStr", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun CourseCard(course: CourseEntity, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        onClick = onClick
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = course.fullName ?: course.shortName ?: "Unknown", style = MaterialTheme.typography.titleMedium)
        }
    }
}
